
const chalk = require('chalk');
const _ = require('lodash');

const utils = require('../utils');
const { Which, requestFromAllPages } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');

const { DataToMarkdown, MarkdownToHTML } = require('./list-pr-output');
const server = require('./http-server');

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red(reason.stack || reason));
});

// args

const baseBranches = process.argv.slice(2);
const currentBranch = baseBranches[baseBranches.length - 1];
const info = `List open pull requests based on branch [${baseBranches}], read dependencies from ${currentBranch}`;
console.log(info);

//

const DONT_MERGE_RE = /\bWIP\b|\bDo(?:n'?t| not)\s*Merge\b/i;
function canMerge (node) {
    if (DONT_MERGE_RE.test(node.title)) {
        console.log(`    skip PR "${node.title}"`);
        return false;
    }
    let skipLabelIndex = node.labels.nodes.findIndex(x => DONT_MERGE_RE.test(x.name));
    if (skipLabelIndex !== -1) {
        console.log(`    skip PR "${node.title}" (label: "${node.labels.nodes[skipLabelIndex].name}")`);
        return false;
    }
    return true;
}

async function queryPepo (which, baseBranches, output) {
    const endTimer = utils.timer(`query pull requests of ${which}`);

    let query = `query pr ($owner: String!, $repo: String!, PageVarDef) {
  repository(owner: $owner, name: $repo) {
    pullRequests (states: OPEN, orderBy: {
      direction: ASC,
      field: CREATED_AT
    }, PageVar) {
      nodes {
        title
        baseRefName
        labels (first: 10) {
          nodes {
            name
          }
        }
        url
        bodyHTML
        author {
          login
        }
        updatedAt
      }
      PageRes
    }
  }
}`;
    let variables = {
        owner: which.owner,
        repo: which.repo,
    };
    let prs = await requestFromAllPages(query, variables, res => {
        let repository = res.repository;
        if (!repository) {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        return repository.pullRequests;
    });
    prs = _(prs)
        .filter(canMerge)
        .filter(x => baseBranches.includes(x.baseRefName))
        .sortBy('baseRefName')
        .value();

    if (prs.length > 0) {
        output.write({ repo: which, prs });
    }

    endTimer();
}

//

async function gatherData (output) {
    const timerName = `Finished list pull requests`;
    console.time(timerName);

    // parse repos
    let fireball = getFireball(currentBranch);
    let packageContent = await getMainPackage(fireball);
    let packageJson = JSON.parse(packageContent);
    let repos = parseDependRepos(packageJson);

    // list pr
    // let promises = [queryPepo(fireball, baseBranches, output), queryPepo(new Which('cocos-creator', 'engine', null), baseBranches, output)];
    let promises = [queryPepo(fireball, baseBranches, output)];
    promises = promises.concat(repos.map(x => queryPepo(x, baseBranches, output)));
    await Promise.all(promises);

    output.end();
    console.timeEnd(timerName);
}

async function gatherMockData (output) {
    output.write({
        repo: new Which('cocos-creator', 'fireball', null),
        prs: [
            {
                "title": "fix editBox bug on wechat browser",
                "baseRefName": "v2.0-release",
                "labels": {
                    "nodes": []
                },
                "url": "https://github.com/cocos-creator/fireball/pull/8816",
                bodyHTML: "<p>Re: <a class=\"issue-link js-issue-link\" data-error-text=\"Failed to load issue title\" data-id=\"419770168\" data-permission-text=\"Issue title is private\" data-url=\"https://github.com/cocos-creator/2d-tasks/issues/1223\" data-hovercard-type=\"issue\" data-hovercard-url=\"/cocos-creator/2d-tasks/issues/1223/hovercard\" href=\"https://github.com/cocos-creator/2d-tasks/issues/1223\">cocos-creator/2d-tasks#1223</a></p>\n<p>添加当前设备最大支持纹理尺寸检测与警告</p>",
                "author": {
                    "login": "JoneLau"
                },
                "updatedAt": "2019-04-02T11:46:29Z",
            },{
                "title": "improve search assets for 2d-tasks/issues/1269",
                "baseRefName": "v2.1-release",
                "labels": {
                    "nodes": []
                },
                "url": "https://github.com/cocos-creator/fireball/pull/8817",
                bodyHTML: "<p>Re: <a class=\"issue-link js-issue-link\" data-error-text=\"Failed to load issue title\" data-id=\"361166720\" data-permission-text=\"Issue title is private\" data-url=\"https://github.com/cocos-creator/2d-tasks/issues/138\" data-hovercard-type=\"issue\" data-hovercard-url=\"/cocos-creator/2d-tasks/issues/138/hovercard\" href=\"https://github.com/cocos-creator/2d-tasks/issues/138\">cocos-creator/2d-tasks#138</a></p>\n<p>Changes:</p>\n<ul>\n<li>添加 Shadow</li>\n</ul>\n<p>效果图</p>\n<p>编辑器中：</p>\n<p><a target=\"_blank\" rel=\"noopener noreferrer\" href=\"https://user-images.githubusercontent.com/7564028/54420000-d5fcb480-4743-11e9-9aa4-d5768a3d6f21.png\"><img src=\"https://user-images.githubusercontent.com/7564028/54420000-d5fcb480-4743-11e9-9aa4-d5768a3d6f21.png\" alt=\"image\" style=\"max-width:100%;\"></a></p>\n",
                "author": {
                    "login": "JoneLau"
                },
                "updatedAt": "2019-04-02T11:46:29Z",
            },
        ],
    });
    output.write({
        repo: new Which('cocos-creator', 'engine', null),
        prs: [
            {
                "title": "modify the blend factor to reduce the duplicate code and add blend factor for the motion-streak.",
                "baseRefName": "v2.0-release",
                "labels": {
                    "nodes": []
                },
                "url": "https://github.com/cocos-creator/engine/pull/4116",
                bodyHTML: "",
                "author": {
                    "login": "JoneLau"
                },
                "updatedAt": "2019-04-02T11:46:29Z",
            },
        ],
    });
    output.end();
}

async function deferredInit (output, toHTML) {
    await utils.sleep();
    server.launch();
    await utils.sleep();
    server.send(toHTML);
    await utils.sleep();
    server.openBrowser();
}

(async function () {

    // init

    let output = new DataToMarkdown(info);
    let toHTML = new MarkdownToHTML();
    output.pipe(toHTML);

    // process concurrently and streaming to server

    await Promise.all([
        gatherData(output),
        deferredInit(output, toHTML),
    ]);
})();
