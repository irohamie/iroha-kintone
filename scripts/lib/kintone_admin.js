'use strict';

const { createClient } = require('./kintone_core.js');

module.exports = createClient({
  baseUrl: 'KINTONE_BASE_URL',
  username: 'TEMP_ADMIN_USERNAME',
  password: 'TEMP_ADMIN_PASSWORD',
});
