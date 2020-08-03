const path = require(`path`);

const NUMBER_REGEXP = /^[0-9]+$/;
const VIRTUAL_REGEXP = /^(\/(?:[^\/]+\/)*?\$\$virtual)((?:\/([^\/]+)(?:\/([^\/]+))?)?((?:\/.*)?))$/;

function resolveVirtual(p) {
  const match = p.match(VIRTUAL_REGEXP);
  if (!match) return p;

  const target = path.dirname(match[1]);
  if (!match[3] || !match[4]) return target;

  const isnum = NUMBER_REGEXP.test(match[4]);
  if (!isnum) return p;

  const depth = Number(match[4]);
  const backstep = `../`.repeat(depth);
  const subpath = match[5] || `.`;

  return resolveVirtual(path.join(target, backstep, subpath));
}

function getVirtualPaths(root) {
  const paths = [];
  if (process.versions.pnp) {
    const pnp = require(`pnpapi`);
    for (const locator of pnp.getDependencyTreeRoots()) {
      const pkg = pnp.getPackageInformation(locator);
      for (const [name, referencish] of pkg.packageDependencies) {
        if (referencish === null) continue;
        if (referencish.indexOf(`virtual:`) === 0) {
          const virtualLocator = pnp.getLocator(name, referencish);
          const virtualPkg = pnp.getPackageInformation(virtualLocator);
          if (virtualPkg && virtualPkg.packageLocation.indexOf(root) === 0) {
            // virtual path fall under root
            paths.push(virtualPkg.packageLocation);
          }
        }
      }
    }
  }
  return paths;
}

function transpose(watchedPath, resolvedPath, p) {
  const transposePath = watchedPath + p.substr(resolvedPath.length);
  return transposePath;
}

/**
 * build raw and resolved path mapping
 * @param {*} root
 */
function buildPathMap(root) {
  const pathMap = new Map();
  const resolvedRoot = resolveVirtual(root);
  pathMap.set(resolvedRoot, root);
  if (!path.extname(root)) {
    // check virtuals when root is a folder.
    const virtualPaths = getVirtualPaths(root);
    virtualPaths.forEach((virtualPath) => {
      const resolvedVirtual = resolveVirtual(virtualPath);
      if (resolvedVirtual.indexOf(resolvedRoot) < 0) {
        pathMap.set(resolvedVirtual, virtualPath);
      }
    });
  }
  return pathMap;
}

class VFS {
  constructor(p, Native) {
    this.root = path.resolve(p);
    this.native = Native;
    this.watchers = [];
  }

  watch(handler) {
    const pathMap = buildPathMap(this.root);
    pathMap.forEach((virtualPath, resolvedPath) => {
      const watcher = this.native.start(resolvedPath, (p, ...args) => {
        return handler(transpose(virtualPath, resolvedPath, p), ...args);
      });
      if (!watcher) throw new Error(`could not watch: ${resolvedPath}`);
      this.watchers.push(watcher);
    });
    return this.watchers;
  }

  stop() {
    const results = this.watchers.map((watcher) => {
      const p = Promise.resolve(watcher);
      if (watcher) {
        p.then(this.native.stop);
      }
      return p;
    });
    this.watchers = [];
    return results[0];
  }
}

module.exports = VFS;
