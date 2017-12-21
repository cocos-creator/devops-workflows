'use strict';

const { join } = require('path');
const utils = require('./utils');
const waterfall = require('async/waterfall');

const settings = utils.getSettings();
const fireball = settings.paths.fireball;

// get tag name
const pkg = require(join(fireball, 'package.json'));
var tag = pkg.version;
console.log('new tag:', tag);

const git = require(join(fireball, 'utils/libs/git'));

function addTag (tag, repo, callback) {
    waterfall([
        // delete the same tag on remote before push
        // (in case the final publish is failed and hotfix again)
        next => {
            git.exec(['push', 'fireball', ':' + tag], repo, next, { autoRetry: true });
        },
        // replace the tag to reference the most recent commit
        (res, next) => {
            git.exec(['tag', '-f', tag], repo, next);
        },
        // push the tag to the remote origin
        (res, next) => {
            git.exec(['push', 'fireball', tag], repo, next, { autoRetry: true });
        }
    ], callback);
}

addTag(tag, fireball, function () {

});
