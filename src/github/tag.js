'use strict';

const semver = require('semver');
require('../global-init');
const { Which, queryTags, querySha, deleteTag, createTag, updateTag } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');

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

async function processRepo (which, tag) {
    let tags = await queryTags(which);

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
