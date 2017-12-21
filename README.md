# Workflows

Workflows for creator team.

## Prerequisite

### Install Node.js

- Mac:

	Install [nvm](https://github.com/creationix/nvm).<br>
	Install [Node.js®](https://nodejs.org/) via nvm:
	```bash
	nvm install node
	```
	And then in any new shell just use the installed version:
	```bash
	nvm use node
	```

- Windows:

	Install [Node.js®](https://nodejs.org/).

### Install modules

```bash
cd path/to/repo
npm install
```

## Commands

**Tag Version**

这个命令将会根据 fireball 下的 package.json 中的 version，自动给所有依赖的 repo 打上 tag，并且推送到 cocos-creator 远端仓库。

```bash
npm run tag
```
