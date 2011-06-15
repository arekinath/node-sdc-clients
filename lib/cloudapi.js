// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var createCache = require('lru-cache');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;

var utils = require('./utils');



///--- Globals

var date = restify.httpDate;
var log = restify.log;
var RestCodes = restify.RestCodes;

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';

var ROOT = '/%s';
var KEYS = ROOT + '/keys';
var KEY = KEYS + '/%s';
var PACKAGES = ROOT + '/packages';
var PACKAGE = PACKAGES + '/%s';
var DATASETS = ROOT + '/datasets';
var DATASET = DATASETS + '/%s';
var DATACENTERS = ROOT + '/datacenters';
var MACHINES = ROOT + '/machines';
var MACHINE = MACHINES + '/%s';
var ANALYTICS = ROOT + '/analytics';
var INSTS = ANALYTICS + '/instrumentations';
var INST = INSTS + '/%s';
var INST_RAW = INST + '/value/raw';
var INST_HMAP = INST + '/value/heatmap/image';
var INST_HMAP_DETAILS = INST + '/value/heatmap/details';



///--- Internal Helpers

function _clone(object) {
  assert.ok(object);

  var clone = {};

  var keys = Object.getOwnPropertyNames(object);
  keys.forEach(function(k) {
    var property = Object.getOwnPropertyDescriptor(object, k);
    Object.defineProperty(clone, k, property);
  });

  return clone;
}


///--- Exported CloudAPI Client

/**
 * Constructor.
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * In order to create a client, you either have to specify username and
 * password, in which case HTTP Basic Authentication will be used, or
 * preferably keyId and key, in which case HTTP Signature Authentication will
 * be used (much more secure).
 *
 * @param {Object} options object (required):
 *        - {String} url (required) CloudAPI location.
 *        - {String} account (optional) the login name to use (default my).
 *        - {Number} logLevel (optional) an enum value for the logging level.
 *        - {String} version (optional) api version (default 6.1.0).
 *        - {String} username (optional) login name.
 *        - {String} password (optional) login password.
 *        - {String} keyId (optional) SSH key id in cloudapi to sign with.
 *        - {String} key (optional) SSH key (PEM) that goes with `keyId`.
 *        - {Boolean} noCache (optional) disable client caching (default false).
 *        - {Boolean} cacheSize (optional) number of cache entries (default 1k).
 *        - {Boolean} cacheExpiry (optional) entry age in seconds (default 60).
 * @throws {TypeError} on bad input.
 * @constructor
 */
function CloudAPI(options) {
  if (!options) throw new TypeError('options required');
  if (!options.url) throw new TypeError('options.url required');
  if (!(options.username && options.password) &&
      !(options.keyId && options.key))
    throw new TypeError('Either username/password or keyId/key are required');

  if (options.logLevel)
    log.level(options.logLevel);
  if (!options.version)
    options.version = '6.1.0';
  this.account = options.account || 'my';

  options.contentType = 'application/json';

  this.client = restify.createClient(options);

  this.options = _clone(options);

  // Try to use RSA Signing over BasicAuth
  if (options.key) {
    this.keyId = options.keyId;
    this.key = options.key;
  } else {
    this.basicAuth = utils.basicAuth(options.username, options.password);
  }

  // Initialize the cache
  if (!options.noCache) {
    this.cacheSize = options.cacheSize || 1000;
    this.cacheExpiry = (options.cacheExpiry || 60) * 1000;
    this.cache = createCache(this.cacheSize);
  }

  // Secret ENV var to not provision (testing)
  if (process.env.SDC_TESTING) {
    log.warn('SDC_TESTING env var set: provisioning will *not* happen');
    this.__no_op = true;
  }
}


/**
 * Looks up your account record.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, account).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getAccount = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var self = this;
  var req = this._request(sprintf(ROOT, account));

  return this._get(req, callback, noCache);
};
CloudAPI.prototype.GetAccount = CloudAPI.prototype.getAccount;


/**
 * Creates an SSH key on your account.
 *
 * Returns a JS object (the created key). Note that options can actually
 * be just the key PEM, if you don't care about names.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Object} options object containing:
 *                   - {String} name (optional) name for your ssh key.
 *                   - {String} key SSH public key.
 * @param {Function} callback of the form f(err, key).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.createKey = function(account, options, callback) {
  if (typeof(options) === 'function') {
    callback = options;
    options = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (!options ||
      (typeof(options) !== 'string' && typeof(options) !== 'object'))
    throw new TypeError('options (object) required');
  if (typeof(account) === 'object')
    account = account.login;

  if (typeof(options) === 'string') {
    options = {
      key: options
    };
  }

  var req = this._request(sprintf(KEYS, account), options);
  return this._post(req, callback);
};
CloudAPI.prototype.CreateKey = CloudAPI.prototype.createKey;


/**
 * Lists all SSH keys on file for your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, keys).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listKeys = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(KEYS, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.ListKeys = CloudAPI.prototype.listKeys;


/**
 * Retrieves an SSH key from your account.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} key can be either the string name of the key, or the object
 *                 returned from create/get.
 * @param {Function} callback of the form f(err, key).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getKey = function(account, key, callback, noCache) {
  if (typeof(key) === 'function') {
    callback = key;
    key = account;
    account = this.account;
  }
  if (!key || (typeof(key) !== 'object' && typeof(key) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(key) === 'object' ? key.name : key);
  var req = this._request(sprintf(KEY, account, name));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.GetKey = CloudAPI.prototype.getKey;


/**
 * Deletes an SSH key from your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} key can be either the string name of the key, or the object
 *                 returned from create/get.
 * @param {Function} callback of the form f(err).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.deleteKey = function(account, key, callback) {
  if (typeof(key) === 'function') {
    callback = key;
    key = account;
    account = this.account;
  }

  if (!key || (typeof(key) !== 'object' && typeof(key) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(key) === 'object' ? key.name : key);
  var req = this._request(sprintf(KEY, account, name));
  return this._del(req, callback);
};
CloudAPI.prototype.DeleteKey = CloudAPI.prototype.deleteKey;


/**
 * Lists all packages available to your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, packages).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listPackages = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(PACKAGES, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.ListPackages = CloudAPI.prototype.listPackages;


/**
 * Retrieves a single package available to your account.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} pkg can be either the string name of the package, or an
 *                 object returned from listPackages.
 * @param {Function} callback of the form f(err, package).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getPackage = function(account, pkg, callback, noCache) {
  if (typeof(pkg) === 'function') {
    callback = pkg;
    pkg = account;
    account = this.account;
  }
  if (!pkg || (typeof(pkg) !== 'object' && typeof(pkg) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(pkg) === 'object' ? pkg.name : pkg);
  var req = this._request(sprintf(PACKAGE, account, name));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.GetPackage = CloudAPI.prototype.getPackage;


/**
 * Lists all datasets available to your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, datasets).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listDatasets = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(DATASETS, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.ListDatasets = CloudAPI.prototype.listDatasets;


/**
 * Retrieves a single dataset available to your account.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} dataset can be either the string name of the dataset, or an
 *                 object returned from listDatasets.
 * @param {Function} callback of the form f(err, package).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getDataset = function(account, dataset, callback, noCache) {
  if (typeof(dataset) === 'function') {
    callback = dataset;
    dataset = account;
    account = this.account;
  }
  if (!dataset ||
      (typeof(dataset) !== 'object' && typeof(dataset) !== 'string'))
    throw new TypeError('dataset (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(dataset) === 'object' ? dataset.id : dataset);
  var req = this._request(sprintf(DATASET, account, name));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.GetDataset = CloudAPI.prototype.getDataset;


/**
 * Lists all datacenters available to your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, datacenters).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listDatacenters = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(DATACENTERS, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.ListDatacenters = CloudAPI.prototype.listDatacenters;


/**
 * Creates a new CloudAPI client connected to the specified datacenter.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} datacenter can be either the string name of the datacenter,
 *                 or an object returned from listDatacenters.
 * @param {Function} callback of the form f(err, package).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.createClientForDatacenter =
  function(account, datacenter, callback, noCache) {
    if (typeof(datacenter) === 'function') {
      callback = datacenter;
      datacenter = account;
      account = this.account;
    }
    if (typeof(datacenter) !== 'string')
      throw new TypeError('datacenter (string) required');
    if (!callback || typeof(callback) !== 'function')
      throw new TypeError('callback (function) required');
    if (typeof(account) === 'object')
      account = account.login;

    var self = this;
    return this.listDatacenters(account, function(err, datacenters) {
      if (err) return err;

      if (!datacenters[datacenter]) {
        var e = new Error();
        e.name = 'CloudApiError';
        e.code = RestCodes.ResourceNotFound;
        e.message = 'datacenter ' + datacenter + ' not found';
        return callback(e);
      }

      var opts = _clone(self.options);
      opts.url = datacenters[datacenter];
      return callback(null, new CloudAPI(opts));
    });
  };
CloudAPI.prototype.CreateClientForDatacenter =
  CloudAPI.prototype.createClientForDatacenter;


/**
 * Provisions a new smartmachine or virtualmachine.
 *
 * Returns a JS object (the created machine). Note that the options
 * object parameters like dataset/package can actually be the JS objects
 * returned from the respective APIs.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Object} options (optional) object containing:
 *                   - {String} name (optional) name for your machine.
 *                   - {String} dataset (optional) dataset to provision.
 *                   - {String} package (optional) package to provision.
 * @param {Function} callback of the form f(err, machine).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.createMachine = function(account, options, callback) {
  if (typeof(account) === 'function') {
    callback = account;
    options = {};
    account = this.account;
  }
  if (typeof(options) === 'function') {
    callback = options;
    options = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(options) !== 'object')
    throw new TypeError('options must be an object');
  if (options.name && typeof(options.name) !== 'string')
    throw new TypeError('options.name must be a string');
  if (typeof(account) === 'object')
    account = account.login;

  if (options.dataset) {
    switch (typeof(options.dataset)) {
    case 'string':
      // noop
      break;
    case 'object':
      options.dataset = options.dataset.id;
      break;
    default:
      throw new TypeError('options.dataset must be a string or object');
    }
  }

  if (options['package']) {
    switch (typeof(options['package'])) {
    case 'string':
      // noop
      break;
    case 'object':
      options['package'] = options['package'].id;
      break;
    default:
      throw new TypeError('options.package must be a string or object');
    }
  }

  // Undocumented flag to skip the actual call (testing only)
  if (this.__no_op)
    return callback(null, {});

  var req = this._request(sprintf(MACHINES, account), options);
  return this._post(req, callback);
};
CloudAPI.prototype.CreateMachine = CloudAPI.prototype.createMachine;


/**
 * Lists all machines running under your account.
 *
 * This API call does a 'deep list', so you shouldn't need to go
 * back over the wan on each id.  Also, note that this API supports
 * filters and pagination; use the options object.  If you don't set
 * them you'll get whatever the server has set for pagination/limits.
 *
 * Also, note that machine listings are both potentially large and
 * volatile, so this API explicitly does no caching.
 *
 * Returns an array of objects, and a boolean that indicates whether there
 * are more records (i.e., you got paginated).  If there are, call this
 * again with offset=machines.length.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Object} options (optional) sets filtration/pagination:
 *                 - {String} name (optional) machines with this name.
 *                 - {String} dataset (optional) machines with this dataset.
 *                 - {String} package (optional) machines with this package.
 *                 - {String} type (optional) smartmachine or virtualmachine.
 *                 - {String} state (optional) machines in this state.
 *                 - {Number} memory (optional) machines with this memory.
 *                 - {Number} offset (optional) pagination starting point.
 *                 - {Number} limit (optional) cap on the number to return.
 * @param {Function} callback of the form f(err, machines, moreRecords).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listMachines = function(account, options, callback) {
  if (typeof(account) === 'function') {
    callback = account;
    options = {};
    account = this.account;
  }
  if (typeof(options) === 'function') {
    callback = options;
    options = account;
    account = this.account;
  }
  if (typeof(options) !== 'object')
    throw new TypeError('options must be an object');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(MACHINES, account));
  req.query = options;
  return this.client.get(req, function(err, obj, headers) {
    if (err)
      err = self._error(err);

    var done = true;
    if (headers['x-resource-count'] && headers['x-query-limit'])
      done = (headers['x-resource-count'] < headers['x-query-limit']);

    log.debug('CloudAPI._get(%s) -> err=%o, obj=%o, done=%s',
              req.path, err, obj, done);
    return callback(err, obj, done);
  });

  };
CloudAPI.prototype.ListMachines = CloudAPI.prototype.listMachines;


/**
 * Gets a single machine under your account.
 *
 * Also, note that machine listings are fairly volatile, so this API
 * explicitly sets the cache TTL to 15s. You can bypass caching altogether
 * with the `noCache` param.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} machine either the id, or can be the object returned in list
 *                 or create.
 * @param {Function} callback of the form f(err, machine).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getMachine = function(account, machine, callback, noCache) {
  if (typeof(machine) === 'function') {
    callback = machine;
    machine = account;
    account = this.account;
  }
  if (!machine ||
      (typeof(machine) !== 'object' && typeof(machine) !== 'string'))
    throw new TypeError('machine (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(machine) === 'object' ? machine.id : machine);
  var req = this._request(sprintf(MACHINE, account, name));
  req.cacheTTL = (15 * 1000);
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.GetMachine = CloudAPI.prototype.getMachine;


/**
 * Reboots a machine under your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} machine either the id, or can be the object returned in list
 *                 or create.
 * @param {Function} callback of the form f(err).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.rebootMachine = function(account, machine, callback) {
  if (typeof(machine) === 'function') {
    callback = machine;
    machine = account;
    account = this.account;
  }
  if (!machine ||
      (typeof(machine) !== 'object' && typeof(machine) !== 'string'))
    throw new TypeError('machine (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  return this._updateMachine(account, machine, 'reboot', callback);
};
CloudAPI.prototype.RebootMachine = CloudAPI.prototype.rebootMachine;


/**
 * Shuts down a machine under your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} machine either the id, or can be the object returned in list
 *                 or create.
 * @param {Function} callback of the form f(err).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.stopMachine = function(account, machine, callback) {
  if (typeof(machine) === 'function') {
    callback = machine;
    machine = account;
    account = this.account;
  }
  if (!machine ||
      (typeof(machine) !== 'object' && typeof(machine) !== 'string'))
    throw new TypeError('machine (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  return this._updateMachine(account, machine, 'stop', callback);
};
CloudAPI.prototype.StopMachine = CloudAPI.prototype.stopMachine;


/**
 * Boots up a machine under your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} machine either the id, or can be the object returned in list
 *                 or create.
 * @param {Function} callback of the form f(err).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.startMachine = function(account, machine, callback) {
  if (typeof(machine) === 'function') {
    callback = machine;
    machine = account;
    account = this.account;
  }
  if (!machine ||
      (typeof(machine) !== 'object' && typeof(machine) !== 'string'))
    throw new TypeError('machine (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  return this._updateMachine(account, machine, 'start', callback);
};
CloudAPI.prototype.StartMachine = CloudAPI.prototype.startMachine;


/**
 * Deletes a machine under your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} machine either the id, or can be the object returned in list
 *                 or create.
 * @param {Function} callback of the form f(err).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.deleteMachine = function(account, machine, callback) {
  if (typeof(machine) === 'function') {
    callback = machine;
    machine = account;
    account = this.account;
  }
  if (!machine ||
      (typeof(machine) !== 'object' && typeof(machine) !== 'string'))
    throw new TypeError('machine (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(machine) === 'object' ? machine.id : machine);
  var req = this._request(sprintf(MACHINE, account, name));
  return this._del(req, callback);
};
CloudAPI.prototype.DeleteMachine = CloudAPI.prototype.deleteMachine;


/**
 * Dumps the "metrics" used in all requets to /analytics.
 *
 * Returns a big object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, metrics).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.describeAnalytics = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(ANALYTICS, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.DescribeAnalytics = CloudAPI.prototype.describeAnalytics;
CloudAPI.prototype.getMetrics = CloudAPI.prototype.describeAnalytics;
CloudAPI.prototype.GetMetrics = CloudAPI.prototype.describeAnalytics;


/**
 * Creates an instrumentation under your account.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Object} options instrumentation options. (see CA docs).
 * @param {Function} callback of the form f(err, instrumentation).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.createInst = function(account, options, callback, noCache) {
  if (typeof(options) === 'function') {
    callback = options;
    options = account;
    account = this.account;
  }
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options (object) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(INSTS, account), options);
  return this._post(req, callback);
};
CloudAPI.prototype.createInstrumentation = CloudAPI.prototype.createInst;
CloudAPI.prototype.CreateInstrumentation = CloudAPI.prototype.createInst;


/**
 * Lists instrumentations under your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, schema).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listInsts = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    noCache = callback;
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var req = this._request(sprintf(INSTS, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.listInstrumentations = CloudAPI.prototype.listInsts;
CloudAPI.prototype.ListInstrumentations = CloudAPI.prototype.listInsts;


/**
 * Gets an instrumentation under your account.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Number} inst either the id, or can be the object returned
 *                 in list or create.
 * @param {Function} callback of the form f(err, instrumentation).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getInst = function(account, inst, callback, noCache) {
  if (typeof(inst) === 'function') {
    noCache = callback;
    callback = inst;
    inst = account;
    account = this.account;
  }

  if (!inst || (typeof(inst) !== 'object' && typeof(inst) !== 'number'))
    throw new TypeError('inst (object|number) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(inst) === 'object' ? inst.id : inst);
  var req = this._request(sprintf(INST, account, name));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.getInstrumentation = CloudAPI.prototype.getInst;
CloudAPI.prototype.GetInstrumentation = CloudAPI.prototype.getInst;


/**
 * Gets an instrumentation raw value under your account.
 *
 * This call is not cachable.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Number} inst either the id, or can be the object returned
 *                 in list or create.
 * @param {Function} callback of the form f(err, instrumentation).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getInstValue = function(account, inst, callback) {
  if (typeof(inst) === 'function') {
    callback = inst;
    inst = account;
    account = this.account;
  }
  if (!inst || (typeof(inst) !== 'object' && typeof(inst) !== 'number'))
    throw new TypeError('inst (object|number) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(inst) === 'object' ? inst.id : inst);
  var req = this._request(sprintf(INST_RAW, account, name));

  return this._get(req, callback, true);
};
CloudAPI.prototype.getInstrumentationValue = CloudAPI.prototype.getInstValue;
CloudAPI.prototype.GetInstrumentationValue = CloudAPI.prototype.getInstValue;


/**
 * Gets an instrumentation heatmap image under your account.
 *
 * This call is not cachable.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Number} inst either the id, or can be the object returned
 *                 in list or create.
 * @param {Function} callback of the form f(err, instrumentation).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getInstHmap = function(account, inst, callback) {
  if (typeof(inst) === 'function') {
    callback = inst;
    inst = account;
    account = this.account;
  }
  if (!inst || (typeof(inst) !== 'object' && typeof(inst) !== 'number'))
    throw new TypeError('inst (object|number) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(inst) === 'object' ? inst.id : inst);
  var req = this._request(sprintf(INST_HMAP, account, name));

  return this._get(req, callback, true);
};
CloudAPI.prototype.getInstrumentationHeatmap = CloudAPI.prototype.getInstHmap;
CloudAPI.prototype.GetInstrumentationHeatmap = CloudAPI.prototype.getInstHmap;


/**
 * Gets an instrumentation heatmap image details.
 *
 * This call is not cachable.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Number} inst either the id, or can be the object returned
 *                 in list or create.
 * @param {Object} options with x and y, as {Number}. Required.
 * @param {Function} callback of the form f(err, instrumentation).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getInstHmapDetails =
  function(account, inst, options, callback) {
    if (typeof(options) === 'function') {
      callback = options;
      options = inst;
      inst = account;
      account = this.account;
    }
    if (!inst || (typeof(inst) !== 'object' && typeof(inst) !== 'number'))
      throw new TypeError('inst (object|number) required');
    if (!options || typeof(options) !== 'object')
      throw new TypeError('options (object) required');
    if (!callback || typeof(callback) !== 'function')
      throw new TypeError('callback (function) required');
    if (typeof(account) === 'object')
      account = account.login;

    var name = (typeof(inst) === 'object' ? inst.id : inst);
    var req = this._request(sprintf(INST_HMAP_DETAILS, account, name));
    req.query = options;

    return this._get(req, callback, true);
  };
CloudAPI.prototype.getInstrumentationHeatmapDetails =
  CloudAPI.prototype.getInstHmapDetails;
CloudAPI.prototype.GetInstrumentationHeatmapDetails =
  CloudAPI.prototype.getInstHmapDetails;


/**
 * Deletes an instrumentation under your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Number} inst either the id, or can be the object returned
 *                 in list or create.
 * @param {Function} callback of the form f(err).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.delInst = function(account, inst, callback) {
  if (typeof(inst) === 'function') {
    callback = inst;
    inst = account;
    account = this.account;
  }
  if (!inst || (typeof(inst) !== 'object' && typeof(inst) !== 'number'))
    throw new TypeError('inst (object|number) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (typeof(account) === 'object')
    account = account.login;

  var name = (typeof(inst) === 'object' ? inst.id + '' : inst);
  var req = this._request(sprintf(INST, account, name));
  return this._del(req, callback);
};
CloudAPI.prototype.deleteInstrumentation = CloudAPI.prototype.delInst;
CloudAPI.prototype.DeleteInstrumentation = CloudAPI.prototype.delInst;



///--- Private Functions

CloudAPI.prototype._updateMachine =
  function(account, machine, action, callback) {
    assert.ok(account);
    assert.ok(machine);
    assert.ok(action);
    assert.ok(callback);

    var name = (typeof(machine) === 'object' ? machine.id : machine);
    var req = this._request(sprintf(MACHINE, account, name));
    req.expect = 202;
    req.query = {
      action: action
    };
    return this._post(req, callback);
  };


CloudAPI.prototype._error = function(err) {
  if (err && err.details && err.details.object && err.details.object.code) {
    var e = new Error();
    e.name = 'CloudApiError';
    e.code = err.details.object.code;
    e.message = err.details.object.message;
    return e;
  }

  return err;
};


CloudAPI.prototype._get = function(req, callback, noCache) {
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  // Check the cache first
  if (!noCache) {
    var cached = this._cacheGet(req.path, req.cacheTTL);
    if (cached) {
      if (cached instanceof Error)
        return callback(cached);

      return callback(null, cached);
    }
  }

  // Issue HTTP request
  return this.client.get(req, function(err, obj, headers) {
    if (err)
      err = self._error(err);

    if (obj)
      self._cachePut(req.path, obj);

    log.debug('CloudAPI._get(%s) -> err=%o, obj=%o', req.path, err, obj);
    return callback(err, obj);
  });
};


CloudAPI.prototype._post = function(req, callback) {
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  // Issue HTTP request
  return this.client.post(req, function(err, obj, headers) {
    if (err)
      err = self._error(err);

    log.debug('CloudAPI._post(%s) -> err=%o, obj=%o', req.path, err, obj);
    return callback(err, obj);
  });
};


CloudAPI.prototype._del = function(req, callback) {
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  // Issue HTTP request
  return this.client.del(req, function(err, headers) {
    if (err) {
      err = self._error(err);
    } else {
      self._cachePut(req.path, null);
    }

    log.debug('CloudAPI._del(%s) -> err=%o', req.path, err);
    return callback(err);
  });
};


CloudAPI.prototype._request = function(path, body) {
  assert.ok(path);

  var now = restify.httpDate();
  var authz;
  if (this.basicAuth) {
    authz = this.basicAuth;
  } else {
    var signer = crypto.createSign('RSA-SHA256');
    signer.update(now);
    authz = sprintf(SIGNATURE,
                    this.keyId,
                    'rsa-sha256',
                    signer.sign(this.key, 'base64'));
  }

  var obj = {
    path: path,
    headers: {
      Authorization: authz,
      Date: now
    }
  };
  if (body)
    obj.body = body;

  return obj;
};


CloudAPI.prototype._cachePut = function(key, value) {
  assert.ok(key);

  if (!this.cache)
    return false;

  if (value === null) {
    // Do a purge
    log.debug('CloudAPI._cachePut(%s): purging', key);
    return this.cache.set(key, null);
  }

  var obj = {
    value: value,
    ctime: new Date().getTime()
  };
  log.debug('CloudAPI._cachePut(%s): writing %o', key, obj);
  this.cache.set(key, obj);
  return true;
};


CloudAPI.prototype._cacheGet = function(key, expiry) {
  assert.ok(key);

  if (!this.cache)
    return null;

  var maxAge = expiry || this.cacheExpiry;

  var obj = this.cache.get(key);
  if (obj) {
    assert.ok(obj.ctime);
    assert.ok(obj.value);
    var now = new Date().getTime();
    if ((now - obj.ctime) <= maxAge) {
      log.debug('CloudAPI._cacheGet(%s): cache hit => %o', key, obj);
      return obj.value;
    }
  }

  log.debug('CloudAPI._cacheGet(%s): cache miss', key);
  return null;
};



///--- Exports

module.exports = CloudAPI;