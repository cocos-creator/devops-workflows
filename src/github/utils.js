
const { Transform } = require('stream');
const _ = require('lodash');
const semver = require('semver');

const ghCssPath = require.resolve('github-markdown-css');
const clipboardPath = require.resolve('clipboard/dist/clipboard.min.js');
const { readFileSync } = require('fs-extra');

const utils = require('../utils');
const settings = utils.getSettings();
const { Which, request, queryText, queryBranches } = require('./github');

async function getMainPackage (which) {
    console.log('  querying depend repo from ');
    return queryText(which, settings.creatorGithub.depend);
}

// get repos from package.json {
//   builtin
//   hosts
//   templates (github.com)
// }
function parseDependRepos (package, branch) {
    const { creatorGithub: { owner} } = settings;
    let repos = [];
    
    for (var key in package) { 
        if (package[key]['workflow'] == true) {
            repoName = package[key]['https']['github'].split('/')[4].split('.')[0]
            //console.log("仓库名：" + repoName);
            let temp_repo = new Which(owner, repoName, branch);
            repos.push(temp_repo);
        }
    }

    return repos
}

function getFireball (branch) {
    //return new Which(settings.creatorGithub.owner, 'fireball', branch);
    return new Which(settings.creatorGithub.owner, settings.creatorGithub.editor, branch);
}

const VERSION_BRANCH_RE = /^v\d+\.\d+(\.\d+)?(?:-release|-patch)?$/i;
const SORT_ORDER = ['__SEMVER__', 'master', 'dev', 'develop', '__FEATURE__'];
function fillBranchInfo (branch) {
    let name;
    if (typeof branch === 'string') {
        name = branch;
        branch = { name };
    }
    else {
        name = branch.name;
    }
    let match = VERSION_BRANCH_RE.exec(name);
    if (match) {
        branch.semver = semver.coerce(name);
        let patch = match[1];
        if (!patch) {
            // v*.* 分支，被解析成了 v*.*.0，实际上应该是 v*.*.max
            branch.semver.patch = Number.MAX_SAFE_INTEGER;
            branch.loose = true;
        }
        else {
            branch.loose = false;
        }
        branch.isMainChannel = true;
        branch.majorSortOrder = SORT_ORDER.indexOf('__SEMVER__');
        if (branch.semver.major < 3) {
            branch.type = 'lts';
        }
        else {
            branch.type = 'current';
        }
    }
    else {
        let index = SORT_ORDER.indexOf(name);
        branch.isMainChannel = index !== -1;
        if (branch.isMainChannel) {
            branch.majorSortOrder = index;
            branch.type = 'main';
        }
        else {
            branch.majorSortOrder = SORT_ORDER.indexOf('__FEATURE__');
            branch.type = 'feature';
        }
        branch.loose = true;
    }
    return branch;
}

function compareBranchesByVersion (lhs, rhs) {
    let res = lhs.majorSortOrder - rhs.majorSortOrder;
    if (res !== 0) {
        return res;
    }
    else if (lhs.semver && rhs.semver) {
        if (semver.gt(lhs.semver, rhs.semver, { includePrerelease: true })) {
            return 1;
        }
        else if (semver.lt(lhs.semver, rhs.semver, { includePrerelease: true })) {
            return -1;
        }
        else if (lhs.name === rhs.name) {
            return 0;
        }
        else if (rhs.name.endsWith('-release')) {
            return 1;
        }
        else {
            return -1;
        }
    }
    else {
        return lhs.name.localeCompare(rhs.name);
    }
}

function sortBranchesByVersion (branches) {
    // 排序分支，提高命中率。
    //   一般我们删除的都会是最旧的版本分支，所以先从旧往新排序
    //   通常功能分支比较独立，所以可以放到最后再判断
    branches.sort(compareBranchesByVersion);
}

function sortBranchesByUpdateTime (branches) {
    branches.sort((lhs, rhs) => {
        return lhs.updatedAt - rhs.updatedAt;
    });
}

async function queryBranchesSortedByTime (which) {
    let branches = await queryBranches(which);
    branches.forEach(fillBranchInfo);
    sortBranchesByUpdateTime(branches);
    return branches;
}

async function queryBranchesSortedByVersion (which) {
    let branches = await queryBranches(which);
    branches.forEach(fillBranchInfo);
    sortBranchesByVersion(branches);
    return branches;
}

async function queryDependReposFromAllBranches () {
    let fireball = getFireball(null);
    let branches = await queryBranchesSortedByTime(fireball);
    branches = branches.filter(x => x.isMainChannel);
    let branchesToParseDep = branches.slice(-3).map(x => x.name);
    let endTimer = utils.timer(`query repos of [${branchesToParseDep}] in ${fireball}`);

    let packages = await Promise.all(branchesToParseDep.map(x => {
        let which = new Which(fireball.owner, fireball.repo, x);
        return getMainPackage(which);
    }));
    
    let repos = packages.map(x => parseDependRepos(JSON.parse(x), x));

    repos = _.uniqBy(_.flatten(repos), x => {
        x.branch = null;    // just compare repos, ignore the differences in those branches
        return String(x);
    });

    endTimer();
    return { repos, branches, branchesToParseDep };
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

const COPY_ELEMENT_RE = /<\s*code\s*>(?!\s*>)/g;

function list (array, callback) {
    return array.map(callback).join('');
}

class MarkdownToHTML extends Transform {
    constructor () {
        super();

        let showdown = require('showdown');
        this.converter = new showdown.Converter({
            openLinksInNewWindow: true,
        });
        this.converter.setFlavor('github');
        this.converter.setOption('ghMentions', false);  // 防止标题出现 @ 时标题的链接会被打断

        this._headerRendered = false;
        this._ids = 0;
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
        let clipboard = readFileSync(clipboardPath, 'utf8');
        let initClipboard = `new ClipboardJS('code', {
            text (trigger) {
                return trigger.getAttribute('data-clipboard-text') || trigger.innerText;
            }
        });`;
        this.push(this._renderFooter([clipboard, initClipboard]));
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
            return this._doRenderHeader(title, css, []) + this._renderMarkdown(text);
        }
        else {
            throw 'Can not resolve html title from ' + text;
        }
    }

    _doRenderHeader (title, css, jsList) {
        return `
<!DOCTYPE HTML>
<html>
    ${list(jsList, x => `
    <script type="text/javascript" charset="utf-8">x</script>`)}
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
            
            .markdown-body code:hover {
                text-decoration: underline;
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

    _renderFooter (jsList) {
        return `
        ${list(jsList, x => `
        <script type="text/javascript" charset="utf-8">${x}</script>`)}
    </body>
</html>`;
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
    fillBranchInfo,
    compareBranchesByVersion,
    sortBranchesByVersion,
    queryDependReposFromAllBranches,
    queryBranchesSortedByVersion,
    queryBranchesSortedByTime,
    DataToMarkdownBase,
    MarkdownToHTML,
    UNIQ_BRANCH_PREFIX : 'deleted-branch-',
};
