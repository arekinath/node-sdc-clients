// Copyright 2012 Joyent, Inc.  All rights reserved.
//

var assert = require('assert');
var fs = require('fs');
var sprintf = require('util').format;
var util = require('util');
var uuid = require('node-uuid');
var vasync = require('vasync');

var Config = require('../lib/config');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');


// --- Globals

var test = helper.test;

var client, role, zoneid;
role = 'testsvc-' + uuid.v4().substr(0, 7);
zoneid = uuid.v4();

var UFDS_IP = process.env.UFDS_IP || '10.2.206.10'; // bh1-kvm6

var options = {
    ufds: {
        url: 'ldaps://' + UFDS_IP,
        bindDN: 'cn=root',
        bindCredentials: 'secret'
    },
    log: helper.log
};

var CONFIG = {
    'robot': 'Bender',
    'good_news_everyone': true,
    'year': 3000,
    'staff': [ 'Leela', 'Zoidberg', 'Amy', 'Fry' ],
    'characters': {
        'Calculon': {
            'acting_talent': 'incredible'
        },
        'Donbot': {
           'says': 'Their desire to keep living shows me no respect.'
        },
        'Clamps': {
            'num': 2
        }
    }
};

test('setup client', function (t) {
    client = new Config(options);
    t.ok(client);
    t.done();
});


// -- Basic tests

test('lookup nonexistent role', function (t) {
    client.lookup('notarole', function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});

test('lookup nonexistent role w/ empty options', function (t) {
    client.lookup('notarole', {}, function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});

test('lookup nonexistent zone', function (t) {
    client.lookup('notarole', { zoneid: uuid.v4() }, function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});

test('lookup nonexistent tag', function (t) {
    client.lookup('notarole', { tag: uuid.v4() }, function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});


// -- Test config files

var nsswitch = '/etc/nsswitch.conf';
var resolv = '/etc/resolv.conf';
var nsswitch_contents, resolv_contents;

test('put text config file', function (t) {
    nsswitch_contents = fs.readFileSync(nsswitch, 'ascii');

    var file = {};
    file.service = 'nsswitch';
    file.type = 'text';
    file.contents = nsswitch_contents;
    file.path = nsswitch;

    client.put(file, role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config file', function (t) {
    client.lookup(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.done();
    });
});

test('lookup config file w/empty options', function (t) {
    client.lookup(role, {}, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.done();
    });
});

test('put another text config file', function (t) {
    resolv_contents = fs.readFileSync(resolv, 'ascii');

    var file = {};
    file.service = 'resolv';
    file.type = 'text';
    file.contents = resolv_contents;
    file.path = resolv;

    client.put(file, role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config files', function (t) {
    client.lookup(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.equal(res['resolv'].path, resolv);
        t.equal(res['resolv'].contents, resolv_contents);
        t.equal(res['resolv'].type, 'text');

        t.done();
    });
});

test('put JSON config file', function (t) {
    var file = {};
    file.service = 'mako';
    file.type = 'json';
    file.contents = CONFIG;
    file.path = '/opt/smartdc/mako/etc/config.json';

    client.put(file, role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config files yet again', function (t) {
    client.lookup(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.equal(res['resolv'].path, resolv);
        t.equal(res['resolv'].contents, resolv_contents);
        t.equal(res['resolv'].type, 'text');

        t.equal(res['mako'].path, '/opt/smartdc/mako/etc/config.json');
        t.deepEqual(res['mako'].contents, CONFIG);
        t.equal(res['mako'].type, 'json');

        t.done();
    });
});

test('delete one config file', function (t) {
    client.del('resolv', role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config files one last time', function (t) {
    client.lookup(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.ok(!res['resolv']);

        t.equal(res['mako'].path, '/opt/smartdc/mako/etc/config.json');
        t.deepEqual(res['mako'].contents, CONFIG);
        t.equal(res['mako'].type, 'json');

        t.done();
    });
});

test('delete the rest of config files', function (t) {
    client.del('mako', role, function (err) {
        t.ifError(err);
        client.del('nsswitch', role, function (suberr) {
            t.ifError(suberr);
            t.done();
        });
    });
});

test('lookup returns an empty object', function (t) {
    client.lookup(role, function (err, res) {
        console.log(res);
        t.equal(Object.keys(res).length, 0);
        t.done();
    });
});

test('put file to be written locally', function (t) {
    var file = {};
    file.service = 'dummy';
    file.type = 'json';
    file.contents = {
        foo: 'bar',
        baz: true,
        myArray: [ 1, 2, 3 ]
    };
    file.path = sprintf('/tmp/dummy.%s.json', role);

    var config;

    var put = function (_, cb) {
        client.put(file, role, function (err) {
            t.ifError(err);
            return (cb(null));
        });
    };

    var lookup = function (_, cb) {
        client.lookup(role, function (err, result) {
            t.ifError(err);
            config = result;
            return (cb(null));
        });
    };

    var write = function (_, cb) {
        client.write(config, function (err) {
            t.ifError(err);
            return (cb(null));
        });
    };

    var verify = function (_, cb) {
        fs.readFile(file.path, 'ascii', function (err, contents) {
            var obj = JSON.parse(contents);
            t.deepEqual(obj, config[file.service].contents);
            return (cb(null));
        });
    };

    var unlink = function (_, cb) {
        fs.unlink(file.path, function (err) {
            t.ifError(err);
            return (cb(null));
        });
    };

    vasync.pipeline({
        funcs: [
            put,
            lookup,
            write,
            verify,
            unlink
        ]
    }, function (err, results) {
        t.ifError(err);
        t.done();
    });
});

test('unbind', function (t) {
    client.unbind(function (err) {
        t.ifError(err);
        t.done();
    });
});