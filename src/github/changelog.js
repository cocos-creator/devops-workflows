
const chalk = require('chalk');
const _ = require('lodash');
const semver = require('semver');

const utils = require('../utils');
const { Which, queryBranches, requestFromAllPages, toDateTime } = require('./github');
const { getFireball, getMainPackage, parseDependRepos, initBranch, sortBranches, MarkdownToHTML } = require('./utils');
const storage = require('./storage');
const storagePath = 'versions';

const { Sort, DataToMarkdown } = require('./changelog-output');
const server = require('./http-server');

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red(reason.stack || reason));
});

// parse args

const program = require('commander');
program.option('-r, --record-version [version]', 'record the current time to the specified version');
if (!process.argv[2].startsWith('-')) {
    // branch (fromTime|fromVersion) ...
    program.branch = process.argv[2];
    program.from = process.argv[3];
    program.option('-t, --to <timeOrVersion>', 'before time like 2019-04-03T03:59:44 or version like 2.0.0-rc.1');
    program.parse(process.argv);

    if (!program.branch) {
        throw 'Missing branch';
    }
    if (!program.from) {
        throw 'Missing fromTime or fromVersion';
    }
    if (semver.valid(program.from)) {
        program.fromVersion = semver.valid(program.from);
    }
    else {
        program.fromTime = new Date(program.from);
        if (!program.fromTime.getTime()) {
            throw 'Invalid fromTime or fromVersion: ' + program.from;
        }
    }
    if (program.to) {
        if (semver.valid(program.to)) {
            program.toVersion = semver.valid(program.to);
        }
        else {
            program.toTime = new Date(program.to);
            if (!program.toTime.getTime()) {
                throw 'Invalid toTime or toVersion: ' + program.to;
            }
        }
    }
    if (typeof program.recordVersion === 'boolean') {
        // version +1
        if (program.fromVersion) {
            program.recordVersion = program.fromVersion.replace(/\d+$/, m => Number(m) + 1);
        }
        else {
            throw 'Missing recordVersion or fromVersion';
        }
    }
}
else {
    // -r recordVersion
    program.parse(process.argv);
    if (typeof program.recordVersion !== 'string') {
        throw 'Missing recordVersion';
    }
}
if (program.recordVersion) {
    if (program.to) {
        throw 'Can not record version when toTime or toVersion is also specified';
    }
    program.recordVersion = semver.valid(program.recordVersion);
    if (!semver.valid(program.recordVersion)) {
        throw 'Invalid recordVersion: ' + program.recordVersion;
    }
}

async function queryPepo (which, from, to, output) {

    // get branches to query

    let branches = await queryBranches(which);
    branches.forEach(initBranch);
    branches = branches.filter(x => x.isMainChannel);
    sortBranches(branches);
    branches = branches.map(x => x.name);
    let index = branches.indexOf(which.branch);
    if (index !== -1) {
        branches = branches.slice(0, index + 1);
        branches.reverse();
    }
    else {
        throw `Can not find ${which}`;
    }

    // query
    //   see https://help.github.com/en/articles/searching-issues-and-pull-requests

    const endTimer = utils.timer(`  query pull requests from ${which.owner}/${which.repo}`);
    let base = branches.map(x => `base:${x}`).join(' ');

    // query 不可以是 variable，否则会被转译，导致查询失败
    let queryBy = `repo:${which.owner}/${which.repo} is:pr is:merged ${base} merged:>=${toDateTime(from)}`;

    let query = `query PR (PageVarDef) {
  search(type: ISSUE, query: "${queryBy}", PageVar) {
    nodes {
      ... on PullRequest {
        title
        url
        author {
          login
        }
        mergedAt
        baseRefName
        bodyText
        number
        repository {
          isPrivate
        }
        # headRefName
        # headRepositoryOwner {
        #   login
        # }
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
    if (to) {
        let toTime = to.getTime();
        prs = prs.filter(x => (new Date(x.mergedAt).getTime() <= toTime));
    }
    // let fromOtherVersions = prs.filter(x => x.headRepositoryOwner.login === which.owner && initBranch({ name: x.headRefName }).isMainChannel);
    prs = prs.value();
    for (let pr of prs) {
        output.write({
            which: new Which(which.owner, which.repo, pr.baseRefName),
            pr
        });
    }
}

//

async function gatherData (output) {
    let endTimer = utils.timer(`list pull requests`);

    // parse repos
    let fireball = getFireball(program.branch);
    let packageContent = await getMainPackage(fireball);
    let packageJson = JSON.parse(packageContent);
    let repos = [fireball].concat(parseDependRepos(packageJson));

    // list pr
    let promises = [fireball].map(x => queryPepo(x, program.fromTime, program.toTime, output));
    // let promises = repos.map(x => queryPepo(x, program.fromTime, program.toTime, output));
    await Promise.all(promises);

    endTimer();
}

async function deferredInit (output, toHTML) {
    await utils.sleep();
    server.launch();
    await utils.sleep();
    server.send(toHTML);
    await utils.sleep();
    server.openBrowser();
}

async function getVersionTime (version) {
    let versions = await storage.get(storagePath);
    let info = versions[version];
    if (info) {
        let date = new Date(info.utcTime);
        if (!date.getTime()) {
            throw `Invalid utcTime '${info.utcTime}' of version '${version}'`;
        }
        return date;
    }
    else {
        throw `Can not find version ${version}`;
    }
}

async function recordVersionTime () {
    let version = program.recordVersion;
    console.log(`Record the current time to the specified version: ${version}`);
    let versions = await storage.get(storagePath);
    let info = versions[version];
    if (!info) {
        versions[version] = info = {};
    }
    let date = new Date();
    info.time = date.toLocaleString();
    info.utcTime = date.getTime();
    await storage.save(storagePath);
}

async function listChangelog () {

    // get version time

    if (program.fromVersion) {
        program.fromTime = await getVersionTime(program.fromVersion);
    }

    if (program.toVersion) {
        program.toTime = await getVersionTime(program.toVersion);
    }

    // show debug info

    let info = `List merged pull requests on '${program.branch}'\nfrom`;
    if (program.fromVersion) {
        info += ` '${program.fromVersion}'`;
    }
    info += ` (${program.fromTime.toLocaleString('zh-cn')})`;
    if (program.to) {
        info += ` to`;
        if (program.toVersion) {
            info += ` '${program.toVersion}'`;
        }
        if (program.toTime) {
            info += ` (${program.toTime.toLocaleString('zh-cn')})`;
        }
    }
    console.log(info);
    console.log(`You must ensure all version branches have been merged to '${program.branch}'`);
    console.log(`  (Or run 'npm run sync-branch')`);

    // init streaming

    let output = new Sort();
    let toMd = new DataToMarkdown(info);
    let toHTML = new MarkdownToHTML();
    output.pipe(toMd).pipe(toHTML);

    // process concurrently and streaming to server

    await Promise.all([
        gatherData(output),
        deferredInit(output, toHTML),
    ]);

    if (program.recordVersion) {
        await recordVersionTime();
    }

    output.end();
}

(async function () {
    if (program.branch) {
        await listChangelog();
    }
    else {
        await recordVersionTime();
    }
})();
