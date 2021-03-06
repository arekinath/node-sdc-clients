/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var Logger = require('bunyan');
var PAPI = require('../lib/index').PAPI;
var util = require('util');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var clone = require('clone');

// --- Globals

var PAPI_IP = process.env.PAPI_IP || '10.99.99.30';
var PAPI_URL = 'http://' + PAPI_IP;
var CUSTOMER = process.env.UFDS_ADMIN_UUID;

var papi;


var entry = {
    name: 'regular_128',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 5120,
    max_swap: 256,
    cpu_cap: 350,
    max_lwps: 2000,
    zfs_io_priority: 1,
    'default': true,
    vcpus: 1,
    active: true,
    networks: [
        'aefd7d3c-a4fd-4812-9dd7-24733974d861',
        'de749393-836c-42ce-9c7b-e81072ca3a23'
    ],
    traits: {
        bool: true,
        arr: ['one', 'two', 'three'],
        str: 'a string'
    }
};

var another_entry = {
    name: 'regular_256',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 5120,
    max_swap: 512,
    cpu_cap: 350,
    max_lwps: 2000,
    zfs_io_priority: 1,
    'default': true,
    vcpus: 1,
    active: true
};

var entry_with_owner = {
    name: 'test_1024',
    version: '1.0.0',
    max_physical_memory: 1024,
    quota: 10240,
    max_swap: 10240,
    cpu_cap: 700,
    max_lwps: 2000,
    zfs_io_priority: 1,
    'default': true,
    vcpus: 2,
    active: true,
    owner_uuids: ['48bc0dd5-97f9-4fcc-bbd9-c48eadc772a0']
};


var PKG;


exports.setUp = function (callback) {
    var logger = new Logger({
            name: 'papi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
    });

    papi = PAPI({
        url: PAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger,
        agent: false
    });

    callback();
};


// Por aquí:
exports.test_create_package = function (t) {
    papi.add(entry, function (err, pkg) {
        t.ifError(err);
        t.ok(pkg);
        t.ok(pkg.uuid);
        t.equal(pkg.vcpus, 1);
        t.equal(pkg.max_swap, 256);
        t.equal(pkg.traits.bool, true);
        t.ok(Array.isArray(pkg.networks));
        t.equal(pkg.networks.length, 2);
        t.deepEqual(pkg.traits.arr, ['one', 'two', 'three']);
        t.equal(pkg.traits.str, 'a string');
        PKG = pkg;
        t.done();
    });
};


exports.test_get_package_by_uuid = function (t) {
    papi.get(PKG.uuid, {}, function (err, pkg) {
        t.ifError(err);
        t.ok(pkg);
        t.equal(pkg.uuid, PKG.uuid);
        t.done();
    });
};


exports.test_get_package_by_uuid_with_owner = function (t) {
    papi.add(entry_with_owner, function (err, pkg) {
        t.ifError(err);
        t.ok(pkg);
        t.ok(pkg.uuid);

        entry_with_owner.uuid = pkg.uuid;

        papi.get(pkg.uuid,
                 { owner_uuids: entry_with_owner.owner_uuids[0] },
                 function (err2, pkg2) {
            t.ifError(err2);
            t.ok(pkg2);
            t.equal(pkg2.uuid, pkg.uuid);
            t.done();
        });
    });
};


exports.test_get_package_by_uuid_with_bad_owner = function (t) {
    papi.get(entry_with_owner.uuid,
             { owner_uuids: '3621c8c3-a5d6-42c6-bcae-f7076353d150' },
             function (err, pkg) {
        t.ok(err);
        t.done();
    });
};


exports.test_modify_mutable_attribute = function (t) {
    var changes = {};
    changes.active = false;
    changes['default'] = false;
    changes.traits = {
        bool: false,
        arr: ['one', 'two', 'three'],
        str: 'a string'
    };
    changes.networks = [
        'de749393-836c-42ce-9c7b-e81072ca3a23'
    ];
    papi.update(PKG.uuid, changes, function (err, pkg) {
        t.ifError(err);
        t.ok(pkg);
        t.equal(pkg.active, false);
        t.equal(pkg['default'], false);
        t.equal(pkg.traits.bool, false);
        t.equal(pkg.networks.length, 1);
        t.ok(Array.isArray(pkg.networks), 'networks is array');
        PKG = pkg;
        t.done();
    });
};


exports.test_modify_immutable_attribute = function (t) {
    var changes = clone(PKG);
    changes.max_physical_memory = 256;
    papi.update(PKG.uuid, changes, function (err) {
        t.ok(err);
        t.ok(/Attempt to update immutables/.test(err.message));

        t.deepEqual(err.body.errors, [ {
            field: 'max_physical_memory',
            code: 'Invalid',
            message: 'is immutable'
        } ]);

        t.done();
    });
};


exports.test_delete_package = function (t) {
    papi.del(PKG.uuid, {}, function (err) {
        t.ok(err);
        t.equal(err.message, 'Packages cannot be deleted');
        t.equal(err.statusCode, 405);
        t.done();
    });
};


exports.test_list_packages = function (t) {
    papi.add(another_entry, function (err, pkg) {
        t.ifError(err);
        t.ok(pkg);
        t.ok(pkg.uuid);
        papi.list({}, {}, function (err2, packages) {
            t.ifError(err2);
            t.ok(util.isArray(packages));
            t.done();
        });
    });
};


exports.test_list_packages_using_wildcards_with_escaping = function (t) {
    papi.list({ name: 'regular_*' }, {}, function (err, packages) {
        t.ifError(err);
        t.ok(util.isArray(packages));
        t.ok(packages.length === 0);
        t.done();
    });
};


exports.test_list_packages_using_wildcards_without_escaping = function (t) {
    papi.list({ name: 'regular_*' }, { escape: false },
              function (err, packages) {
        t.ifError(err);
        t.ok(util.isArray(packages));
        t.ok(packages.length > 0);
        t.done();
    });
};


exports.test_search_packages = function (t) {
    var filter = '(max_physical_memory=128)';
    papi.list(filter, {}, function (err, packages) {
        t.ifError(err);
        t.ok(util.isArray(packages));
        packages.forEach(function (p) {
            t.equal(128, p.max_physical_memory);
        });
        t.done();
    });
};


exports.tearDown = function (callback) {
    papi.close();
    callback();
};