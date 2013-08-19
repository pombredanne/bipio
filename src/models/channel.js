/**
 *
 * The Bipio API Server
 *
 * @author Michael Pearson <michael@cloudspark.com.au>
 * Copyright (c) 2010-2013 CloudSpark pty ltd http://www.cloudspark.com.au
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * A Bipio Commercial OEM License may be obtained via enquiries@cloudspark.com.au
 */
/**
 *
 * Channels are configuration instances for pods, they are both a model and a
 * strategy/bridge pattern for interacting with channel pods and their related
 * actions.
 *
 */
var BipModel = require('./prototype.js').BipModel,
    helper = require('../lib/helper');

// register pods
var pods = {};
for (var podName in CFG.pods) {
    pods[podName] = require('bip-pod-' + podName);
    app.logmessage('Pod: ' + podName + ' UP');
}

/**
 * @todo - channel actions should not be changeable after the initial create
 *
 */
function applyAction(channelAction) {
    if (validAction(channelAction)) {
        var podAction = Channel.getPodTokens(channelAction);
        if (podAction.ok()) {
            this.config = pods[podAction.pod].importGetDefaults(podAction.action);
        }
    }
    return channelAction;
}


function validAction(value) {
    var ok = false;
    ok = (undefined != value && value != '' && value != 0);
    if (ok) {
        var tTokens = value.split('.');
        var pod = tTokens[0], podAction = tTokens[1];
        ok = (undefined != pods[pod] && undefined != pods[pod].getSchema(podAction));
    }
    return ok;
}

var Channel = Object.create(BipModel);

Channel.entityName = 'channel';
Channel.entitySchema = {
    id: {
        type: String,
        renderable: true,
        writable: false
    },

    owner_id : {
        type: String,
        renderable: false,
        writable: false
    },

    name: {
        type: String,
        renderable: true,
        required : true,
        writable: true,
        "default" : "",
        validate : [
        {
            validator : BipModel.validators.notempty,
            msg : "Cannot be empty"
        },
        {
            validator : BipModel.validators.len_64,
            msg : "64 characters max"
        }
        ]
    },

    action: {
        type: String,
        renderable: true,
        required : true,
        writable: true,
        set : applyAction,
        "default" : "",

        validate : [
        {
            validator : BipModel.validators.notempty,
            msg : "Cannot be empty"
        },

        {
            validator : function(val, next) {
                next( validAction(val) );
            },
            msg : 'Invalid Pod or Action'
        },

        {
            validator : function(val, next) {
                var ok = false;
                if (validAction(this.action)) {
                    // validate the config for this action
                    ok = true;
                }
                next(ok);
            },
            msg : 'Action Configuration Error'
        }
        ]
    },

    config:  {
        type: Object,
        renderable: true,
        required : true,
        writable: true,
        "default" : {},
        validate : [
        {
            validator : BipModel.validators.notempty,
            msg : "Cannot be empty"
        },
        {
            validator : function(val, next) {
                var ok = false;
                if (validAction(this.action)) {
                    // validate the config for this action
                    ok = true;
                }
                next(ok);
            },
            msg : 'Invalid Config'
        }
        ]
    },

    _available : {
        type: Boolean,
        renderable: true,
        writable: false,
        "default" : true
    },
    note: {
        type: String,
        renderable: true,
        writable: true,
        validate : [
        {
            validator : BipModel.validators.max_text,
            msg : "Text is too long, 1kb max"
        }
        ]
    },
    created : {
        type: String,
        renderable: true,
        writable: false
    }
};

Channel.compoundKeyContraints = {
    "owner_id" : 1,
    "name" : 1,
    "action" : 1
};

// Pod Binder
Channel.staticChildInit = function() {
    // initialize each channel pod
    for (var idx in pods) {   
        pods[idx].init(this.getDao(), CFG.pods[idx] );
    }

    return this;
};

/**
 * Transforms adjacentExports into an import usable by this Channel.  Transforms
 * are applied to imports under these conditions
 *
 *  - import < explicit export
 *  - import < template
 *  - import < _bip.{attribute}
 *  - import < _client.{attribute}
 *  - import < {channel_id}.{attribute}
 *  - no transforms, exports = import (do not need to explicitly transform 1:1)
 *
 */
Channel._transform = function(adjacentExports, transforms, client, bip) {
    var self = this,
    pod = this.getPodTokens();
    actionImports = pods[pod.name].getImports(pod.action), // expected imports
    resolvedImports = {}, // final imports for the channel
    localKey = 'local#'
    //
    // flattens adjacent exports so that we have a dot notation form to directly
    // matched against.
    flattenedExports = helper.flattenObject(adjacentExports, '#');

    // copy action Imports into resolved Imports, with empty values or exact
    // matches
    for (var localImport in actionImports) {
        resolvedImports[localImport] = (flattenedExports[localKey + localImport] ?
            flattenedExports[localKey + localImport] :
            ''
            );
    }

    if (Object.keys(transforms).length) {
        var key;
        var tplPattern;

        for (var dst in transforms) {
            //key = transforms[dst][i];
            key = transforms[dst];

            if (undefined === resolvedImports[dst]) {
                resolvedImports[dst] = '';
            }

            // match explicit key
            if (flattenedExports[key]) {
                importVal = flattenedExports[key];

            // match 'local. derived key'
            } else if (flattenedExports[localKey + key]) {
                importVal = flattenedExports[localKey + key];

            } else {

                // no exact match? Try and template it. Template engines are
                // too insecure, so we roll a basic pattern match only for
                // [% attribute %] or [% _bip.attribute %] or whatever
                for (var exp in flattenedExports) {
                    // if local expressin in exports, then drop it and try to match
                    if (/^local#/.test(exp)) {
                        expLocal = exp.replace(/^local#/, '');
                    } else {
                        expLocal = exp;
                    }

                    // it doesn't matter too much if people inject 'undefined'
                    // into their transform template...
                    key = String(key).replace(new RegExp("\\[%(\\s*?)(" + expLocal + '|' + exp + ")(\\s*?)%\\]", 'g'), flattenedExports[ exp ]);

                }
                importVal = key;
            }
            resolvedImports[dst] += importVal;

        }
    } else {
        resolvedImports = adjacentExports.local;
    }

    return resolvedImports;
}

/**
 *
 * Applies transforms to imports for this channel and invokes this channel
 *
 */
Channel.invoke = function(adjacentExports, transforms, client, contentParts, next) {
    var self = this;

    var transformedImports = this._transform(adjacentExports, transforms, client),
    podTokens = this.getPodTokens(),
    podName = podTokens.name;

    // invoke method
    client.owner_id = this.owner_id;
    if (pods[podName].isOAuth()) {
        pods[podName].oAuthGetToken(this.owner_id, podName, function(err, oAuthToken, tokenSecret, authProfile) {
            if (!err && oAuthToken) {
                client._oauth_token = oAuthToken;
                client._oauth_token_secret = tokenSecret;
                client._oauth_profile = authProfile;
                pods[podName].invoke(podTokens.action, self, transformedImports, client, contentParts, next);
            }
        });
    } else {
        pods[podName].invoke(podTokens.action, this, transformedImports, client, contentParts, next);
    }
}

Channel.pod = function(podName) {
    var ret;
    if (podName) {
        if (undefined != pods[podName]) {
            ret = pods[podName];
        }
    } else {
        ret = pods;
    }
    return ret;
}

Channel.getActionList = function() {
    var schema, result = [];

    for (pod in pods) {
        schema = pods[pod].getSchema();
        for (action in schema) {
            // @todo 'admin' actions should be surfaced to admin users
            if (!schema[action].trigger && !schema[action].admin) {
                result.push(pod + '.' + action);
            }
        }
    }
    return result;
}

Channel.getEmitterList = function() {
    var schema, result = [];

    for (pod in pods) {
        schema = pods[pod].getSchema();
        for (action in schema) {
            // @todo 'admin' actions should be surfaced to admin users
            if (schema[action].trigger && !schema[action].admin) {
                result.push(pod + '.' + action);
            }
        }
    }
    return result;
}

// post save, run pod initialization
/**
 *
 * @param {Object} sysInfo struct of { 'user' : account info, 'sys' : system generic }
 *
 */
Channel.postSave = function(accountInfo, next, isNew) {
    var tTokens = this.action.split('.');
    var pod = tTokens[0], action = tTokens[1];

    if (undefined == pod || undefined == action) {
        // throw a constraint crit
        console.log('crit: Channel [' + this.id + '] Init post save but no action?');
        throw DEFS.ERR_CONSTRAINT;
        return;
    }

    // channels behave a little differently, they can have postponed availability
    // after creation, which the pod actions themselves might want to dictate.
    pods[pod].setup(action, this, accountInfo, next);
    if (isNew) {   
        app.bastion.createJob(DEFS.JOB_USER_STAT, { owner_id : accountInfo.user.id, type : 'channels_total' } );
    }
}

Channel.getPodTokens = function() {
    var ret = {
        ok : function() {
            return (undefined != this.pod);
        }
    };
    if (this.action) {
        var tokens = this.action.split('.');
        if (tokens.length == 2) {
            ret.name = ret.pod = tokens[0];
            ret.action = tokens[1];
            ret._struct = pods[ret.pod];
            ret.getSchema = function(key) {
                //var ptr = pods[this.pod]['_schemas'][this.action];
                var ptr = pods[this.pod].getSchema(this.action);
                if (key && ptr[key]) {
                    return ptr[key];
                }
                return ptr;
            };
            ret.isTrigger = function() {
                //return pods[this.pod]['_schemas'][this.action].trigger;
                return pods[this.pod].isTrigger(this.action);
            },
            // get all unique keys
            ret.getSingletonConstraints = function() {
                var schema = this.getSchema(),
                constraints = {}, singleton = false;

                for (key in schema.config.properties) {
                    if (schema.config.properties[key].unique) {
                        singleton = true;
                        constraints[key] = schema.config.properties;
                    }
                }

                return singleton ? constraints : null;
            }
        }
    }
    return ret;
}

// We try to inject defaults into channel configs to avoid patching documents
// in mongo with default configs as they change.
Channel.getConfig = function() {
    var config = {};

    pod = this.getPodTokens();
    var podConfig = pods[pod.name].importGetConfig(pod.action);
    for (key in podConfig.properties) {
        if (!this.config[key] && podConfig.properties[key]['default']) {
            config[key] = podConfig.properties[key]['default'];
        } else if (this.config[key]) {
            config[key] = this.config[key];
        }
    }
    return config;
}

/**
 * Tests a named import is valid for the configured chanenl
 */
Channel.testImport = function(importName) {
    var ok = false,
    pod = this.getPodTokens();

    if (pod.ok()) {
        ok = pods[pod.name].testImport(pod.action, importName);
    }

    return ok;
}

/**
 * Given a transformSource lookup, retrieves the default transform for this
 * channels configured pod.action
 *
 */
Channel.getTransformDefault = function(transformSource) {
    var transform,
    action = this.getPodTokens();

    if (action.ok()) {
        transform = pods[action.pod].getTransformDefault(transformSource, action.action);
    }
    return transform;
}

/**
 * Channel representation
 */
Channel.repr = function(accountInfo) {
    var repr = '';
    var action = this.getPodTokens();

    if (action.ok()) {
        repr = pods[action.pod].repr(action.action, this);
        this.attachRenderer(accountInfo);
    }



    return repr;
}

Channel.getRendererUrl = function(renderer, accountInfo) {
    var action = this.getPodTokens(),
    rStruct,
    ret;

    if (action.ok()) {
        rStruct = action.getSchema('renderers');
        if (rStruct[renderer]) {
            //ret = this._dao.getBaseUrl() + '/rpc/render/channel/' + this.getIdValue() + '/' + renderer;
            ret = accountInfo.getDefaultDomainStr(true) + '/rpc/render/channel/' + this.getIdValue() + '/' + renderer;
        }
    }

    return ret;
}

Channel.attachRenderer = function(accountInfo) {
    var action = this.getPodTokens();

    if (action.ok()) {
        rStruct = action.getSchema();
        if (rStruct && rStruct.renderers) {
            this._renderers = {};
            for (var idx in rStruct.renderers) {
                this._renderers[idx] = rStruct.renderers[idx]
                this._renderers[idx]._href = this.getRendererUrl(idx, accountInfo);
            }
        }
    }
}

Channel.href = function() {
    return this._dao.getBaseUrl() + '/rest/' + this.entityName + '/' + this.getIdValue();
}

module.exports.Channel = Channel;