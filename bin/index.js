#!/usr/bin/env node
const yargs = require("yargs");
const npm = require("npm");
const https = require("https");
const marked = require("marked");
const chalk = require("chalk");
const TerminalRenderer = require("marked-terminal");
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

const argv = yargs
  .usage("Usage: $0 <package name>")
  .alias("e", "editor")
  .describe("e", "Editor for preview [vim | nano | cat]")
  .default("e", "terminal")
  .alias("v", "version")
  .help("help")
  .epilog("Copyright " + new Date().getFullYear).argv;

if (!argv._ || argv._.length === 0) {
  console.error("Not specified package name");
  process.exit(9);
}

function parseGHPackageName(data) {
  const key = Object.keys(data)[0];
  if (key) {
    const path = data[key].repository.url;
    return /github.com([^\.]+)\.git/.exec(path)[1];
  }
}

function getGHPackageName(npmPackageName) {
  return new Promise(function (resolve, reject) {
    npm.load("package.json", function (err) {
      if (err) {
        return reject(err);
      }
      npm.commands.view([npmPackageName], function (err, output) {
        if (err) {
          return reject(err);
        }
        return resolve(parseGHPackageName(output));
      });
    });
  });
}

function getDefaultBranch(ghname) {
  return new Promise(function (resolve, reject) {
    const options = {
      host: "api.github.com",
      port: 443,
      path: "/repos" + ghname,
      // authentication headers
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "npm-info-app",
      },
    };
    https
      .get(options, function (res) {
        let data = "";
        res.on("data", function (chunk) {
          data += chunk;
        });
        res.on("end", function () {
          const json = JSON.parse(data);
          resolve(json.default_branch);
        });
      })
      .on("error", reject);
  });
}

function getMdFile(repositoryName, branch, filename) {
  return new Promise(function (resolve, reject) {
    https
      .get(
        `https://raw.githubusercontent.com${repositoryName}/${branch}/${filename}`,
        function (res) {
          if (res.statusCode === 200) {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              resolve(data);
            });
          } else {
            reject(res.statusCode);
          }
        }
      )
      .on("error", reject);
  });
}

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

const packageName = argv._[0];

getGHPackageName(packageName)
  .then(function (ghname) {
    return getDefaultBranch(ghname).then(function (branchName) {
      return getMdFile(ghname, branchName, "README.md").catch(function (err) {
        if (err === 400) {
          return getMdFile(ghname, branchName, "readme.md");
        }
        throw Error(err);
      });
    });
  })
  .then(function (md) {
    if (argv.terminal || argv.editor === "terminal") {
      marked.setOptions({
        renderer: new TerminalRenderer({
          reflowText: true,
          width: 80,
          link: chalk.blueBright,
          href: chalk.blueBright.underline,
        }),
      });
      console.log(marked(md));
    } else {
      const fileName = `/tmp/nrm/${packageName}.md`;
      ensureDirectoryExistence(fileName);
      fs.writeFile(fileName, md, function (err) {
        if (err) {
          throw new Error(err);
        }
        const child = child_process.spawn(argv.editor, [fileName], {
          stdio: "inherit",
        });
        child.on("exit", function () {
          fs.unlinkSync(fileName);
        });
      });
    }
  })
  .catch(console.error);
