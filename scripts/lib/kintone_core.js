'use strict';

const crypto = require('node:crypto');

const RETRY_DELAYS_MS = [1000, 2000, 4000];

function createClient(envNames) {
  function getConfig() {
    const baseUrl = process.env[envNames.baseUrl];
    const username = process.env[envNames.username];
    const password = process.env[envNames.password];

    if (!baseUrl) {
      throw new Error('環境変数 ' + envNames.baseUrl + ' が設定されていません');
    }
    if (!username) {
      throw new Error('環境変数 ' + envNames.username + ' が設定されていません');
    }
    if (!password) {
      throw new Error('環境変数 ' + envNames.password + ' が設定されていません');
    }

    return { baseUrl: baseUrl.replace(/\/+$/, ''), username: username, password: password };
  }

  function authHeader() {
    const config = getConfig();
    return Buffer.from(config.username + ':' + config.password).toString('base64');
  }

  function buildUrl(path, params) {
    const config = getConfig();
    const url = new URL(config.baseUrl + path);
    if (params) {
      for (const key of Object.keys(params)) {
        url.searchParams.set(key, String(params[key]));
      }
    }
    return url;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function throwKintoneError(res) {
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (parseError) {
      json = null;
    }

    if (json && (json.code || json.id || json.message)) {
      const parts = [];
      if (json.code) parts.push('code=' + json.code);
      if (json.id) parts.push('id=' + json.id);
      if (json.message) parts.push('message=' + json.message);
      throw new Error('kintone APIエラー（HTTP ' + res.status + '）: ' + parts.join(', '));
    }

    const snippet = text.slice(0, 500);
    throw new Error('kintone APIエラー（HTTP ' + res.status + '、JSON以外の応答）: ' + snippet);
  }

  async function request(method, path, options) {
    const opts = options || {};
    const params = opts.params;
    const body = opts.body;
    const isMultipart = opts.isMultipart;
    const formData = opts.formData;

    const url = buildUrl(path, method === 'GET' ? params : undefined);
    const headers = {
      'X-Cybozu-Authorization': authHeader(),
    };

    let fetchBody;
    if (isMultipart) {
      fetchBody = formData;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: method,
          headers: headers,
          body: fetchBody,
        });
      } catch (networkError) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error('kintoneへの接続に失敗しました: ' + networkError.message);
      }

      if (res.status >= 200 && res.status < 300) {
        return res;
      }

      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      await throwKintoneError(res);
    }

    throw new Error('kintone APIへのリクエストが予期せず終了しました');
  }

  async function apiGet(path, params) {
    const res = await request('GET', path, { params: params });
    return res.json();
  }

  async function apiGetBinary(path, params) {
    const res = await request('GET', path, { params: params });
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async function apiPost(path, bodyObject) {
    const res = await request('POST', path, { body: bodyObject });
    return res.json();
  }

  async function apiPut(path, bodyObject) {
    const res = await request('PUT', path, { body: bodyObject });
    return res.json();
  }

  async function apiDelete(path, bodyObject) {
    const res = await request('DELETE', path, { body: bodyObject });
    return res.json();
  }

  async function apiPostFile(buffer, fileName, contentType) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), fileName);
    const res = await request('POST', '/k/v1/file.json', { isMultipart: true, formData: form });
    const json = await res.json();
    return json.fileKey;
  }

  function md5(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  return {
    apiGet: apiGet,
    apiGetBinary: apiGetBinary,
    apiPost: apiPost,
    apiPut: apiPut,
    apiDelete: apiDelete,
    apiPostFile: apiPostFile,
    md5: md5,
  };
}

module.exports = {
  createClient: createClient,
};
