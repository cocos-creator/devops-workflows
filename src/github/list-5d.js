
const program = require('commander');
const chalk = require('chalk');
const _ = require('lodash');
const semver = require('semver');
const fs = require('fs-extra');

require('../global-init');
const utils = require('../utils');
const { Which, requestFromAllPages, toDateTime, queryRef } = require('./github');
const { getFireball, getMainPackage, compareBranchesByVersion, parseDependRepos, MarkdownToHTML, fillBranchInfo } = require('./utils');
const storage = require('./storage');
const StoragePath = 'versions';

const { Sort, DataToMarkdown } = require('./changelog-output');
const server = require('./http-server');

const REF_RE = /^(?:Re:|ref)\s*[^\s:]*\s+/i;
const PREFIX_RE = /^(?:Changelog:|Changes:|改动概括：)/i;

const settings = utils.getSettings();

// polyfill
String.prototype.matchAll = String.prototype.matchAll || function(regexp) {
    var matches = [];
    this.replace(regexp, function() {
        var arr = ([]).slice.call(arguments, 0);
        var extras = arr.splice(-2);
        arr.index = extras[0];
        arr.input = extras[1];
        matches.push(arr);
    });
    return matches.length ? matches : [];
};

(function initArgs () {
    let command = process.argv[2];
    if (command === 'collect') {
        // 从这个 tag 后开始处理
        let tag = process.argv[3];
        console.log(`Collect pull requests since '${tag}'`);
        console.log(`You must ensure all version branches have been merged to dev/master (By running 'npm run sync-branch').'`);
        console.log(``);
        collectPRs(tag);
    }
    else if (command === 'merge') {
        // 合并各个仓库的 pr 到 prs/all.json
        console.log(`Merge files`);
        console.log(``);
        mergePRs();
    }
    else if (command === 'clear') {
        // 剔除不需要迁移的 pr 到 prs/all-cleared.json
        console.log(`Clear unconcerned pull requests`);
        console.log(``);
        clearPRs();
    }
    else if (command === 'link') {
        // 建立 pr 之间的关联到 prs/all-linked.json
        console.log(`Link pull requests`);
        console.log(``);
        linkPRs();
    }
    else if (command === 'md') {
        // 输出到 prs/res/author.md
        console.log(`Markdown pull requests`);
        console.log(``);
        mdPRs();
    }
    else {
        console.error(`Unknown command`);
        process.exit(1);
    }
})();

function mergePRs () {
    let files = fs.readdirSync('./prs');
    let all = {};
    for (const file of files) {
        if (!file.endsWith('.json')) {
            continue;
        }
        let repo = file.slice(0, -5);
        let prs = fs.readJsonSync(`./prs/${file}`);
        prs = _.sortBy(prs, x => -(new Date(x.mergedAt).getTime()));
        for (const pr of prs) {
            pr.repo = repo;
            let authorPrs = all[pr.author];
            if (!authorPrs) {
                authorPrs = all[pr.author] = [];
            }
            authorPrs.push(pr);
        }
    }
    fs.writeJsonSync(`./prs/all.json`, all, { spaces: 2 });
}


function notMerge (pr) {
    /*
"title": "merging from 3d-v1.0.0",
"title": "V2.1 release(merge v2.0 release)",
Dev(merge v2.1 release)",
merge dev to gpi
"title": "Merge v21 to v22",
V2.4.0 merge
"title": " fix label node size with outLine component (merge #5145)",
"title": "V2.1 release merge v2.0 release",
"title": "merge v2.0 to v2.1",
"title": "V2.1 merge skeleton optimize",
"title": "sync #5376",
"title": "sync branch",
sync v2.1-release branch
"title": "cherry-pick commit for EditBox on 3d branch",
"bodyText": "cherry pick from 2.1",
"title": "Merge 2.1.3 to 2.2.0",
"title": "Merge branch 'v2.1.4-release' into 'v2.2.1-release'",
Sync v2.3.4
*/
    const RE_MERGE = /((\bmerge\b|\bmerging\b).+(\d+\.\d+|v\d{2,3}|\bdev\b|\bmaster\b|\bdevelop\b|#\d+))|(v\d\.\d.+\bmerge\b)|\bsync\b\s+#\d+|\bsync\b.+\bbranch\b|\bSync\b\s+v\d.\d|cherry-pick|cherry\s+pick/i;
    return !RE_MERGE.test(pr.title);
}

function rightBranch (pr) {
    const RE_BRANCH = /dev|master|v\d+\.\d+/;
    return RE_BRANCH.test(pr.baseRefName) && !pr.baseRefName.startsWith('3d-');
}

function existsIn3D (pr) {
    const ALLOW_LIST = ['fireball/pull/9265', 'engine/pull/6194'];
    const RE_2D_FEATURES = /collider|collision|particle|physics|physical|tile[d\s-]*map|TiledTile|Tiledlayer|tmx|spine|dragon[\s-]*bone|Asset[\s-]*Manager|asset[\s-]*bundle|motion[\s-]*streak|video[\s-]*player|web[\s-]*view|safe[\s-]*area|free[\s-]*type|label[\s-]*shadow|loadRes|sub[\s-]*context|open[\s-]*data|sub[\s-]*domain|cull|qqplay|package.json|action|migrate|skeleton|\b3d\b|light|camera|\bdeferred\b|\bci\b|gulp|shader|material|dynamic[\s-]*Atlas|model|fbx|skinning|shadow|babel|typescript|tslib|create.d.ts|creator.d.ts|\s+d.ts|ipc|update package|bundle|gizmo|sub[\s-]*package|asset[\s-]*library|cacheManager|facebook|meta/i;
    for (const item of ALLOW_LIST) {
        if (pr.url.endsWith(item)) {
            return true;
        }
    }
    return !RE_2D_FEATURES.test(pr.title);
}

function clearPRs () {
    let all = fs.readJsonSync(`./prs/all.json`);
    let res = {};
    for (let author in all) {
        if (author === 'CocosRobot') {
            continue;
        }
        let prs = _(all[author])
            .filter(notMerge)
            .filter(rightBranch)
            .filter(existsIn3D)
        ;
        prs = res[author] = prs.value();
    }
    fs.writeJsonSync(`./prs/all-cleared.json`, res, { spaces: 2 });
}

function linkPRs () {
    const RE_LINK = /([\w-]*)#(\d+)|github\.com\S+\/(\S+)\/pull\/(\d+)/g;
    let all = fs.readJsonSync(`./prs/all-cleared.json`);

    function getPR (repo, number) {
        number = Number.parseInt(number);
        for (let author in all) {
            let prs = all[author];
            let index = prs.findIndex(x => x.repo === repo && x.number === number);
            if (index >= 0) {
                let pr = prs[index];
                // prs.splice(index, 1);
                return pr;
            }
        }
        return null;
    }

    // 建立关联
    for (let author in all) {
        let prs = all[author];
        for (const pr of prs) {
            let matches = (pr.title + '\n' + pr.bodyText).matchAll(RE_LINK);
            for (const match of matches) {
                let linkedPR = match[2] ? getPR(match[1] || pr.repo, match[2]) : getPR(match[3], match[4]);
                if (linkedPR && linkedPR !== pr) {
                    if (pr.links && pr.links === linkedPR.links) {
                        continue;
                    }
                    if (linkedPR.links) {
                        if (pr.links) {
                            let links = _.uniq(pr.links.concat(linkedPR.links));
                            for (const item of links) {
                                item.links = links;
                            }
                        }
                        else {
                            let links = pr.links = linkedPR.links;
                            if (!links.includes(pr)) {
                                links.push(pr);
                            }
                        }
                    }
                    else {
                        if (pr.links) {
                            let links = linkedPR.links = pr.links;
                            if (!links.includes(linkedPR)) {
                                links.push(linkedPR);
                            }
                        }
                        else {
                            linkedPR.links = pr.links = [pr, linkedPR];
                        }
                    }
                }
            }
        }
    }

    // 重新排序
    for (let author in all) {
        let prs = all[author];
        for (const pr of prs) {
            if (pr.links) {
                // 由新到旧
                pr.links.sort((lhs, rhs) => {
                    return new Date(rhs.mergedAt).getTime() - new Date(lhs.mergedAt).getTime();
                });
            }
        }
        // 由旧到新
        prs.sort((lhs, rhs) => {
            return new Date(lhs.mergedAt).getTime() - new Date(rhs.mergedAt).getTime();
        });
    }

    // 剔除冗余关联
    for (let author in all) {
        let prs = all[author].slice();
        for (const pr of prs) {
            if (pr.links && pr.links[0] === pr) {
                for (let i = 1; i < pr.links.length; ++i) {
                    let linkedPR = pr.links[i];
                    let prs = all[linkedPR.author];
                    let index = prs.findIndex(x => x.repo === linkedPR.repo && x.number === linkedPR.number);
                    if (index >= 0) {
                        prs.splice(index, 1);
                    }
                    else {
                        console.error('Can not find ' + linkedPR);
                    }
                    linkedPR.links = undefined;
                }
                pr.links.shift();
            }
        }
    }

    fs.writeJsonSync(`./prs/all-linked.json`, all, { spaces: 2 });
}

function mdPRs () {
    let all = fs.readJsonSync(`./prs/all-linked.json`);
    function mdify (pr) {
        return `[${pr.title}](${pr.url})  in **${pr.repo}** by _${pr.author}_\n`;
    }
    function bodify (text) {
        return `${text.trim().replace(REF_RE, '').replace(PREFIX_RE, '').trim().replace(/`/g, '').replace(/\n/g, '  ')}`;
    }
    let task = ' - [ ] ';
    for (let author in all) {
        let prs = all[author];
        let res = '### 按时间先后顺序排列，做完请打勾以便追踪进度。\n\n';
        let page = 0;
        let sum = 0;
        for (const pr of prs) {
            res += task + mdify(pr);
            let body = bodify(pr.bodyText);
            if (body) {
                res += `   \`${body}\`\n`;
            }
            ++sum;
            if (pr.links) {
                for (const linkedPR of pr.links) {
                    ++sum;
                    res += `  ${task}Re: ${mdify(linkedPR)}`;
                    let body = bodify(linkedPR.bodyText);
                    if (body) {
                        res += `      \`${body}\`\n`;
                    }
                }
            }
            if (sum % 100 === 0) {
                fs.outputFileSync(`./prs/res/${author}_${page}.md`, res, 'utf8');
                res = '';
                ++page;
            }
        }
        res += `\n总数：${sum}`;
        if (sum > 0) {
            fs.outputFileSync(`./prs/res/${author}_${page}.md`, res, 'utf8');
        }
    }
}

async function collectPRs (tag) {
    let fireball = getFireball('dev');
    let packageContent = await getMainPackage(fireball);
    let packageJson = JSON.parse(packageContent);
    let repos = [fireball].concat(parseDependRepos(packageJson));

    let editorTag = await queryRef(fireball, null, tag);
    let editorStartTime = new Date(editorTag.updatedAt);
    fireball.startTime = editorStartTime;
    console.log(`Fireball starts from ${editorStartTime.toLocaleString('zh-cn')}`);

    let engine = repos.find(x => x.repo === 'engine');
    let engineTag = await queryRef(engine, null, tag);
    let engineStartTime;
    if (engineTag) {
        engineStartTime = new Date(engineTag.updatedAt);
        console.log(`engine starts from ${engineStartTime.toLocaleString('zh-cn')}`);
    }
    else {
        engineStartTime = editorStartTime;
        console.log(`engine + 1`);
    }
    engine.startTime = engineStartTime;

    let jsb = repos.find(x => x.repo === 'jsb-adapter');
    let jsbTag;
    try {
        jsbTag = await queryRef(jsb, null, tag);
    }
    catch (e) {
    }
    if (jsbTag) {
        let jsbStartTime = new Date(jsbTag.updatedAt);
        let lite = repos.find(x => x.repo === 'cocos2d-x-lite');
        lite.startTime = jsb.startTime = jsbStartTime;
        console.log(`native starts from ${jsbStartTime.toLocaleString('zh-cn')}`);
    }

    // let prs = await queryPepo(engine, engineStartTime);

    for (const repo of repos) {
        if (fs.existsSync(`./prs/${repo.repo}.json`)) {
            continue;
        }
        if (['weapp-adapter', 'adapters'].includes(repo.repo)) {
            continue;
        }
        if (!repo.startTime) {
            repo.startTime = engineStartTime;
            console.log(`${repo.repo} starts from ${engineStartTime.toLocaleString('zh-cn')}`);
        }
        let prs = await queryPepo(repo, repo.startTime);
        fs.writeJsonSync(`./prs/${repo.repo}.json`, prs.value(), { spaces: 2 });
    }
}

async function queryPepo (which, from) {

    const endTimer = utils.timer(`  query pull requests from ${which.owner}/${which.repo}`);
    let condition = `merged:>=${toDateTime(from)}`;
    // let condition = `merged:2018-08-07T03:45:13Z..2018-09-18T07:29:39Z`;
    console.log(condition);

    // query 不可以是 variable，否则会被转译，导致查询失败
    //   see https://help.github.com/en/articles/searching-issues-and-pull-requests
    let queryBy = `repo:${which.owner}/${which.repo} is:pr is:merged ${condition}`;

    let query = `query PR (PageVarDef) {
  search(type: ISSUE, query: "${queryBy}", PageVar) {
    nodes {
      ... on PullRequest {
        mergedAt
        baseRefName
        number
        url
        title
        bodyText
        author {
          login
        }
      }
    }
    PageRes
  }
}`;
    let prs = await requestFromAllPages(query, {}, res => {
        // if (!res.search) {
        //     throw `Failed to access ${which.repo}, please check permission of the token`;
        // }
        return res.search;
    });
    endTimer();

    // output

    prs = _(prs);
    // if (to) {
    //     // Filter by time
    //     let toTime = to.getTime();
    //     prs = prs.filter(x => (new Date(x.mergedAt).getTime() <= toTime));
    // }

    // Filter by branch
    // let currentBranchInfo = fillBranchInfo(which.branch);
    // prs = prs.filter(x => {
    // });

    prs.forEach(pr => {
        pr.bodyText = pr.bodyText.replace(REF_RE, '').replace(PREFIX_RE, '');
        pr.author = pr.author.login;
        Object.defineProperty(pr, 'mergedAtTime', {
            value: new Date(pr.mergedAt).getTime(),
        });
    });

    prs = prs.sortBy(x => -x.mergedAtTime);

    return prs;
}
