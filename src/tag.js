'use strict';

const { join } = require('path');
const series = require('async/series');
const program = require('commander');

const utils = require('./utils');
const git = require('./git');

const remote = 'fireball';

program
    .option('--path <path>', 'Specify the path of the fireball or cocos2d-x-lite repo')
    .parse(process.argv);

function addRepoTag (tag, path, callback) {
    series([
        // delete the same tag on remote before push
        // (in case the final publish is failed and hotfix again)
        next => {
            git.exec(['push', remote, ':' + tag], path, next, { autoRetry: true });
        },
        // replace the tag to reference the most recent commit
        next => {
            git.exec(['tag', '-f', tag], path, next);
        },
        // push the tag to the remote origin
        next => {
            git.exec(['push', remote, tag], path, next, { autoRetry: true });
        }
    ], callback);
}

function doTagFireballRepo (path, tagName, callback) {
    // change cwd to main repo
    var originCwd = process.cwd();
    process.chdir(path);

    series([
        // setup remote
        next => {
            utils.gulp(['add-fireball-remote'], '.', next);
        },
        // working on main repo
        next => {
            addRepoTag(tagName, '.', next);
        },
        // working on sub repos
        next => {
            const eachSubRepos = require(join(path, 'gulpfile')).eachSubRepos;
            eachSubRepos((repoInfo, next) => {
                addRepoTag(tagName, repoInfo.localPath, next);
            }, next);
        },
    ], (err) => {
        // restore cwd
        process.chdir(originCwd);

        callback && callback(err);
    });
}

function tagSpecifiedRepo (path) {
    const pkg = require(join(path, 'package.json'));
    // get tag name
    let tagName = pkg.version;
    console.log(`add tag [${tagName}] on ${path}`);

    if (pkg.name === 'CocosCreator') {
        doTagFireballRepo(path, tagName);
    }
    else if (pkg.name === 'cocos2d-x-lite') {
        addRepoTag(tagName, path);
    }
    else {
        console.error('unknown repo');
    }
}

function tagConfigedRepo () {
    // get path from settings
    const settings = utils.getSettings();
    const fireball = settings.paths.fireball;
    // get tag name
    const pkg = require(join(fireball, 'package.json'));
    let tagName = pkg.version;
    console.log(`add tag [${tagName}] on configured ${fireball}`);

    series([
        // working on fireball
        next => {
            doTagFireballRepo(fireball, tagName, next);
        },
        // working on cocos2d-x-lite
        next => {
            addRepoTag(tagName, settings.paths['cocos2d-x-lite'], next);
        }
    ]);
}

if (program.path) {
    tagSpecifiedRepo(program.path);
}
else {
    tagConfigedRepo();
}
