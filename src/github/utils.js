
const { Transform } = require('stream');
const _ = require('lodash');
const semver = require('semver');
const ghCssPath = require.resolve('github-markdown-css');
const { readFileSync } = require('fs-extra');
const utils = require('../utils');
const settings = utils.getSettings();
const { Which, request, queryText, queryBranches } = require('./github');

async function getMainPackage (which) {
    console.log('  querying package.json from ' + which);
    return queryText(which, 'package.json');
}

// get repos from package.json {
//   builtin
//   hosts
//   templates (github.com)
// }
function parseDependRepos (package) {
    const { builtin, hosts, templates, externDefs } = package;
    const { creatorGithub: { owner, ownerPackages} } = settings;

    function parseRepos (repos, owner) {
        return repos.map(entry => {
            let [repo, branch] = entry.split('#');
            return new Which(owner, repo, branch);
        });
    }
    let repos = [];
    repos = repos.concat(parseRepos(builtin, ownerPackages));
    repos = repos.concat(parseRepos(hosts, owner));

    for (let key in templates) {
        let url = templates[key];
        let entry = Which.fromDownloadUrl(url);
        if (entry) {
            repos.push(entry);
        }
    }

    // cocos2d-x-lite
    let cocos2dx = new Which(owner, 'cocos2d-x-lite');
    if (externDefs) {
        cocos2dx.branch = externDefs['cocos2d-x_branch'];
    }
    else {
        throw 'Unknown branch of cocos2d-x-lite';
    }
    repos.push(cocos2dx);

    return repos;
}

function getFireball (branch) {
    return new Which(settings.creatorGithub.owner, 'fireball', branch);
}

const VERSION_BRANCH_RE = /^v\d+\.\d+(\.\d+)?(?:-release)?$/i;
const SORT_ORDER = ['__SEMVER__', 'master', 'dev', 'develop', '__FEATURE__'];
function initBranch (branch) {
    let name = branch.name;
    let match = VERSION_BRANCH_RE.exec(name);
    if (match) {
        branch.semver = semver.coerce(name);
        let patch = match[1];
        if (!patch) {
            // v*.* 分支，被解析成了 v*.*.0，实际上应该是 v*.*.9999
            branch.semver.patch = Number.MAX_SAFE_INTEGER;
        }
        branch.isMainChannel = true;
        branch.mainChannelOrder = SORT_ORDER.indexOf('__SEMVER__');
    }
    else {
        let index = SORT_ORDER.indexOf(branch.name);
        branch.isMainChannel = index !== -1;
        if (branch.isMainChannel) {
            branch.mainChannelOrder = index;
        }
        else {
            branch.mainChannelOrder = SORT_ORDER.indexOf('__FEATURE__');
        }
    }
}

function sortBranches (branches) {
    // 排序分支，提高命中率。
    //   一般我们删除的都会是最旧的版本分支，所以先从旧往新排序
    //   通常功能分支比较独立，所以可以放到最后再判断
    branches.sort((lhs, rhs) => {
        let res = lhs.mainChannelOrder - rhs.mainChannelOrder;
        if (res !== 0) {
            return res;
        }
        else if (lhs.semver && rhs.semver) {
            // both 0
            if (semver.gt(lhs.semver, rhs.semver)) {
                return 1;
            }
            else if (semver.lt(lhs.semver, rhs.semver)) {
                return -1;
            }
            else if (rhs.name.endsWith('-release')) {
                return 1;
            }
            else {
                return -1;
            }
        }
        else {
            // both -1
            return lhs.name.localeCompare(rhs.name);
        }
    });
}

async function queryDependReposFromAllBranches () {
    let fireball = getFireball(null);
    let branches = await queryBranches(fireball);
    branches.forEach(initBranch);
    branches = branches.filter(x => x.isMainChannel);
    sortBranches(branches);
    let branchesToParseDep = branches.slice(-3).map(x => x.name);
    let endTimer = utils.timer(`query repos of ${branchesToParseDep} in ${fireball}`);

    let packages = await Promise.all(branchesToParseDep.map(x => {
        let which = new Which(fireball.owner, fireball.repo, x);
        return getMainPackage(which);
    }));
    let repos = packages.map(x => parseDependRepos(JSON.parse(x)));
    repos = _.uniqBy(_.flatten(repos), x => {
        x.branch = null;    // just compare repos, ignore the differences in those branches
        return String(x);
    });

    endTimer();
    return { repos, branches };
}

class DataToMarkdownBase extends Transform {
    constructor (info) {
        super({
            writableObjectMode: true,
        });

        this.push(this._renderHeader(info));
    }
    _transform (chunk, encoding, callback) {
        // console.log(chunk);
        this.push(this._renderChunk(chunk));
        callback();
    }
    _final (callback) {
        let text = this._renderFooter();
        this.push(text);
        callback();
    }

    _renderHeader (info) {
        throw '_renderHeader NYI';
    }
    _renderChunk (info) {
        throw '_renderChunk NYI';
    }
    _renderFooter () {
        return `
----
<div align="center">
Made wtih 🖤️ by jare
</div>
`;
    }
}

class MarkdownToHTML extends Transform {
    constructor () {
        super();

        let showdown = require('showdown');
        this.converter = new showdown.Converter({
            openLinksInNewWindow: true,
        });
        this.converter.setFlavor('github');

        this._headerRendered = false;
    }
    _transform (chunk, encoding, callback) {
        if (!this._headerRendered) {
            this.push(this._renderHeader(chunk.toString()));
            this._headerRendered = true;
        }
        else {
            this.push(this._renderMarkdown(chunk.toString()));
        }
        callback();
    }
    _final (callback) {
        this.push(this._renderFooter());
        callback();
    }

    _renderHeader (text) {
        let css = readFileSync(ghCssPath, 'utf8');
        const GET_TITLE_RE = /^ *# *(.+)/m;
        let title;
        text = text.replace(GET_TITLE_RE, function (match, g1) {
            title = g1;
            return `<h1 align="center">${title}</h1>`;
        });
        if (title) {
            return this._doRenderHeader(title, css) + this._renderMarkdown(text);
        }
        else {
            throw 'Can not resolve html title from ' + text;
        }
    }

    _doRenderHeader (title, css) {
        return `
<!DOCTYPE HTML>
<html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <style>
            .markdown-body {
                box-sizing: border-box;
                min-width: 200px;
                max-width: 980px;
                margin: 0 auto;
                padding: 45px;
            }
        
            @media (max-width: 767px) {
                .markdown-body {
                    padding: 15px;
                }
            }
            
        ${css}
        </style>
    </head>
    <body class="markdown-body">`;
    }

    _renderFooter () {
        return `</body></html>`;
    }

    _renderMarkdown (text) {
        let content = this.converter.makeHtml(text);
        return content;
    }
}

module.exports = {
    getFireball,
    getMainPackage,
    parseDependRepos,
    initBranch,
    sortBranches,
    queryDependReposFromAllBranches,
    DataToMarkdownBase,
    MarkdownToHTML,
};
