
const chalk = require('chalk');
const _ = require('lodash');
const semver = require('semver');

require('../global-init');
const utils = require('../utils');
const { Which, requestFromAllPages, toDateTime } = require('./github');
const { getFireball, getMainPackage, compareBranchesByVersion, parseDependRepos, MarkdownToHTML, fillBranchInfo } = require('./utils');
const storage = require('./storage');
const StoragePath = 'versions';

const { Sort, DataToMarkdown } = require('./changelog-output');
const server = require('./http-server');

const settings = utils.getSettings();

// parse args

const program = require('commander');
program.option('-r, --record-version [version]', 'record the current time to the specified version');
if (!process.argv[2].startsWith('-')) {
    // branch [fromTime|fromVersion] ...
    program.branch = process.argv[2];
    if (!program.branch) {
        throw 'Missing branch';
    }
    if (process.argv[3] && !process.argv[3].startsWith('-')) {
        program.from = process.argv[3];
    }
    program.option('-t, --to <timeOrVersion>', 'before time like 2019-04-03T03:59:44 or version like 2.0.0-rc.1');
    program.parse(process.argv);
}
else {
    // -r recordVersion
    program.parse(process.argv);
    if (typeof program.recordVersion !== 'string') {
        throw 'Missing recordVersion';
    }
}

const REF_RE = /^(?:Re:|ref)\s*[^\s:]*\s+/i;
const PREFIX_RE = /^(?:Changelog:|Changes:)/i;

async function queryPepo (which, from, to, output) {

    // Only query old branches
    // let branches;
    // if (from) {
    //     // get branches to query
    //     branches = await queryBranchesSortedByVersion(which);
    //     branches = branches.filter(x => x.isMainChannel);
    //     branches = branches.map(x => x.name);
    //     let index = branches.indexOf(which.branch);
    //     if (index !== -1) {
    //         branches = branches.slice(0, index + 1);
    //     }
    //     else {
    //         throw `Can not find ${which}`;
    //     }
    // }
    // else {
    //     // only query one branch
    //     branches = [which.branch];
    // }
    // let base = branches.map(x => `base:${x}`).join(' ');

    const endTimer = utils.timer(`  query pull requests from ${which.owner}/${which.repo}`);
    let condition = from ? `merged:>=${toDateTime(from)}` : `base:${which.branch}`;
    
    // query 不可以是 variable，否则会被转译，导致查询失败
    //   see https://help.github.com/en/articles/searching-issues-and-pull-requests
    let queryBy = `repo:${which.owner}/${which.repo} is:pr is:merged ${condition}`;

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
        // Filter by time
        let toTime = to.getTime();
        prs = prs.filter(x => (new Date(x.mergedAt).getTime() <= toTime));
    }
    if (from) {
        // Filter by branch
        let currentBranchInfo = fillBranchInfo(which.branch);
        prs = prs.filter(x => {
            // if (x.baseRefName === 'v2.2.1') {
            //     // HACK: 临时处理已删除的分支
            //     return true;
            // }
            let prBranchInfo = fillBranchInfo(x.baseRefName);
            // console.log(which.branch + ' ' + x.baseRefName + ' ' + compareBranchesByVersion(currentBranchInfo, prBranchInfo));
            return compareBranchesByVersion(currentBranchInfo, prBranchInfo) >= 0;
        });
    }
    prs.forEach(pr => {
        let author = pr.author;
        author.name = settings.usernames[author.login] || author.login;
        pr.bodyText = pr.bodyText.replace(REF_RE, '').replace(PREFIX_RE, '');
        output.write({
            which: new Which(which.owner, which.repo, pr.baseRefName),
            pr
        });
    });
    // let fromOtherVersions = prs.filter(x => x.headRepositoryOwner.login === which.owner && fillBranchInfo(x.headRefName).isMainChannel);
}

//

async function gatherData (output) {
    let endTimer = utils.timer(`list pull requests`);

    // parse repos
    let fireball = getFireball(program.branch);
    let packageContent = await getMainPackage(fireball);
    let packageJson = JSON.parse(packageContent);
    let repos = [fireball].concat(parseDependRepos(packageJson));

    if (!program.fromTime) {
        // filter unmodified repo
        let branchInfo = fillBranchInfo(program.branch);
        function isSameVersion (value) {
            if (!branchInfo.semver) {
                return value.branch === program.branch;
            }
            let valueInfo = fillBranchInfo(value.branch);
            if (!valueInfo.semver) {
                return false;
            }
            if (branchInfo.loose || valueInfo.loose) {
                return (branchInfo.semver.major === valueInfo.semver.major &&
                        branchInfo.semver.minor === valueInfo.semver.minor);
            }
            else {
                return (branchInfo.semver.major === valueInfo.semver.major &&
                        branchInfo.semver.minor === valueInfo.semver.minor &&
                        branchInfo.semver.patch === valueInfo.semver.patch);
            }
        }
        repos = repos.filter(isSameVersion);
    }

    // list pr
    // let promises = [fireball].map(x => queryPepo(x, program.fromTime, program.toTime, output));
    let promises = repos.map(x => queryPepo(x, program.fromTime, program.toTime, output));
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
    let versions = await storage.get(StoragePath);
    let info = versions[version];
    if (!info) {
        let found = _(versions)
            .toPairs()
            .filter(x => x[0].startsWith(version))
            .maxBy(x => x[1].utcTime);
        if (found) {
            console.warn(chalk.yellow(`Can not find version ${version}, choose ${found[0]} intead.`));
            [version, info] = found;
        }
    }
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
    let versions = await storage.get(StoragePath);
    let info = versions[version];
    if (!info) {
        versions[version] = info = {};
    }
    let date = program.toTime || new Date();
    info.time = date.toLocaleString();
    info.utcTime = date.getTime();
    await storage.save(StoragePath);
}

async function getLastVersion (branch) {
    let branchInfo = fillBranchInfo(branch);
    var branchSemver = branchInfo.semver;
    let latestVersion = null;
    if (branchSemver) {
        let range;
        if (branchInfo.loose) {
            // v0.0 or dev/master
            range = new RegExp(`^${branchSemver.major}\\.${branchSemver.minor}\\.\\d+`);
        }
        else {
            // v0.0.0
            range = new RegExp(`^${branchSemver.major}\\.${branchSemver.minor}\\.${branchSemver.patch}\\b`);
        }

        let latestTime = null;
        let versions = await storage.get(StoragePath);
        for (let version in versions) {
            if (!range.test(version)) {
                continue;
            }
            let time = versions[version].utcTime;
            if (!latestVersion || time > latestTime) {
                latestVersion = version;
                latestTime = time;
            }
        }
    }

    if (latestVersion) {
        console.log(`Found last version ${latestVersion} from branch ${branch}`);
    }
    else {
        console.log(`Can not find last version for branch ${branch}`);
    }
    return latestVersion;
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

    let info1 = `List merged pull requests on '${program.branch}'`;
    let info2;
    if (program.from) {
        info2 = 'from';
        if (program.fromVersion) {
            info2 += ` '${program.fromVersion}'`;
        }
        info2 += ` (${program.fromTime.toLocaleString('zh-cn')})`;
    }
    if (program.to) {
        info2 += ` to`;
        if (program.toVersion) {
            info2 += ` '${program.toVersion}'`;
        }
        if (program.toTime) {
            info2 += ` (${program.toTime.toLocaleString('zh-cn')})`;
        }
    }
    let info = [info1, info2].filter(Boolean).join('\n');
    console.log(info);
    console.log(`You must ensure all version branches have been merged to '${program.branch} (By run 'npm run sync-branch').'`);

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

    // init args

    if (program.branch) {
        if (!program.from) {
            program.from = await getLastVersion(program.branch);
            if (!program.from) {
                console.log('Will list all pull requests on the branch only');
            }
        }

        if (semver.valid(program.from)) {
            program.fromVersion = semver.valid(program.from);
        }
        else if (program.from) {
            program.fromTime = new Date(program.from);
            if (!Number.isFinite(program.fromTime.getTime())) {
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

    if (program.recordVersion) {
        program.recordVersion = semver.valid(program.recordVersion);
        if (!semver.valid(program.recordVersion)) {
            throw 'Invalid recordVersion: ' + program.recordVersion;
        }
    }

    if (program.branch) {
        await listChangelog();
    }
    else {
        await recordVersionTime();
    }
})();
