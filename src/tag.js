
'use strict';

const { join } = require('path');
const series = require('async/series');
const program = require('commander');
const { promisify } = require('util');

const utils = require('./utils');
const git = require('./git');

const remote = 'fireball';

program
    .option('--path <path>', 'Specify the path of the editor or cocos-engine repo')
    .parse(process.argv);

function addRepoTag (tag, path, callback) {

    let exec = promisify((cmds, path, options, callback) => {
        if (!callback) {
            callback = options;
            options = undefined;
        }
        git.exec(cmds, path, callback, options);
    });

    (async () => {
        var gaTag = tag.replace(/-.+$/, '');
        var devTag = gaTag + '-dev'; // keep only one developing version
        var isDevTag = gaTag !== tag;
        if (isDevTag) {
            tag = devTag;
        }
        // delete the same tag on remote before push
        // (in case the final publish is failed and hotfix again)
        await exec(['push', remote, ':' + gaTag], path, { autoRetry: true });
        await exec(['push', remote, ':' + devTag], path, { autoRetry: true });

        // replace the tag to reference the most recent commit
        await exec(['tag', '-f', tag], path);

        // push the tag to the remote origin
        await exec(['push', remote, tag], path, { autoRetry: true });

    })().then(callback, callback);
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
    const pkg = require(join(path, 'repo.json'));
    // get tag name
    let tagName = pkg.version;
    console.log(`add tag [${tagName}] on ${path}`);

    if (pkg.name === 'CocosCreator') {
        doTagFireballRepo(path, tagName);
    }
    else if (pkg.name === 'cocos-engine') {
        addRepoTag(tagName, path);
    }
    else {
        console.error('unknown repo');
    }
}

function tagConfigedRepo () {
    // get path from settings
    const settings = utils.getSettings();
    const fireball = settings.paths.editor;
    // get tag name
    const pkg = require(join(fireball, 'repo.json'));
    let tagName = pkg.version;
    console.log(`add tag [${tagName}] on configured ${fireball}`);

    series([
        // working on fireball
        next => {
            doTagFireballRepo(fireball, tagName, next);
        },
        // working on cocos-engine
        next => {
            addRepoTag(tagName, settings.paths['cocos-engine'], next);
        }
    ]);
}

if (program.path) {
    tagSpecifiedRepo(program.path);
}
else {
    tagConfigedRepo();
}
