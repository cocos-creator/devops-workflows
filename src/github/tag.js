'use strict';

const semver = require('semver');
const groupBy = require('lodash/groupBy');
require('../global-init');
const { Which, queryTags, querySha, deleteTag, createTag, updateTag } = require('./github');
const { getFireball, getMainPackage, parseDependRepos, UNIQ_BRANCH_PREFIX } = require('./utils');

const RESERVE_DEV_TAG_COUNT = 4;
const PRERELEASE_RE = /-.+$/;

// args

let [tagName, whichBranch, oneRepo] = process.argv.slice(2);

let gaTagName, devTagName;
let isSemver = semver.valid(tagName);
let isDevTag = isSemver && PRERELEASE_RE.test(tagName);
if (isDevTag) {
    gaTagName = tagName.replace(PRERELEASE_RE, '');
    tagName = devTagName = gaTagName + '-dev';
}
else {
    gaTagName = tagName;
    devTagName = tagName + '-dev';
}

let info = `Create tag "${tagName}" on branch "${whichBranch}"`;
if (oneRepo) {
    info += ` for "${oneRepo}"`;
}
console.log(info);

function sortDevSemVersByVersion (semvers) {
    semvers.sort((lhs, rhs) => {
        if (semver.gt(lhs, rhs)) {
            return 1;
        }
        else if (semver.lt(lhs, rhs)) {
            return -1;
        }
        else {
            return 0;
        }
    });
}

async function cleanDevTags (which, tags, reserveCount) {
    let devSemVers = tags.map(x => semver.parse(x))
        .filter(x => x && x.prerelease.length > 0);
    sortDevSemVersByVersion(devSemVers);
    let devSemVersToDelete = devSemVers.slice(0, -reserveCount);
    if (devSemVersToDelete.length > 0) {
        // console.log(`Delete tags [${devSemVersToDelete}] from ${which.owner}/${which.repo}`);
        await Promise.all(devSemVersToDelete.map(x => deleteTag(which, x.raw)));
    }
}

async function cleanTags (which) {
    let tags = await queryTags(which);
    let versions = groupBy(tags, ({ name }) => {
        if (name.startsWith('3d-') || name.endsWith('-dev')) {
            return name;
        }
        if (name.startsWith(UNIQ_BRANCH_PREFIX)) {
            name = name.slice(UNIQ_BRANCH_PREFIX.length);
        }

        let sv = semver.parse(name);
        if (sv) {
            return `${sv.major}.${sv.minor}.${sv.patch}`;
        }
        else {
            return name;
        }
    });

    for (let ver in versions) {
        let sameVerTags = versions[ver];
        if (sameVerTags.length > 1) {
            if (sameVerTags[0].commit.oid === sameVerTags[1].commit.oid) {
                if (sameVerTags[0].name.length > sameVerTags[1].name.length) {
                    console.log('  remove ' + sameVerTags[0].name + ' in ' + which);
                    await deleteTag(which, sameVerTags[0].name);
                }
                else {
                    console.log('  remove ' + sameVerTags[1].name + ' in ' + which);
                    await deleteTag(which, sameVerTags[1].name);
                }
            }
            // choose best, 将最符合需求的排在第一位
            // sameVerTags.sort((lhs, rhs) => {
            //     // if (lhs.commit.oid === rhs.commit.oid) {
            //     //     // 如果是同一个提交，取名字短的
            //     //     return lhs.name.length - rhs.name.length;
            //     // }
            //     let timeL = (new Date(lhs.commit.pushedDate)).getTime();
            //     let timeR = (new Date(rhs.commit.pushedDate)).getTime();
            //     let res = timeR - timeL;
            //     if (res === 0) {
            //         // 如果是同一个提交，取名字短的
            //         res = lhs.name.length - rhs.name.length;
            //         if (res === 0) {
            //             // 应该不会有这种情况出现
            //             res = lhs.name.localeCompare(rhs.name);
            //         }
            //     }
            //     return res;
            // });
            console.log(which);
            console.log(sameVerTags);
        }
    }
}

async function processRepo (which, tag) {
    // return cleanTags(which);
    let tags = await queryTags(which);
    tags = tags.map(x => x.name);

    // clean same version tag
    if (isDevTag) {
        if (tags.includes(gaTagName)) {
            await deleteTag(which, gaTagName);
        }
    }
    else if (tags.includes(devTagName)) {
        await deleteTag(which, devTagName);
    }

    // update tag
    let sha = await querySha(which);
    if (!sha) {
        throw `Can not get ref from ${which}, please check permission of the token`;
    }
    if (tags.includes(tag)) {
        await updateTag(which, tag, sha);
    }
    else {
        await createTag(which, tag, sha);
    }

    // clean other tags
    if (isDevTag) {
        await cleanDevTags(which, tags.filter(x => x !== tag), RESERVE_DEV_TAG_COUNT - 1);
    }
}

(async function () {
    if (oneRepo) {
        await processRepo(new Which(oneRepo), tagName);
    }
    else {
        let fireball = getFireball(whichBranch);
        let packageContent = await getMainPackage(fireball);
        let packageJson = JSON.parse(packageContent);
        let repos = parseDependRepos(packageJson);

        let promises = [processRepo(fireball, tagName)];
        promises = promises.concat(repos.map(x => processRepo(x, tagName)));
        await Promise.all(promises);
    }

    console.log(`Finished`);
})();
