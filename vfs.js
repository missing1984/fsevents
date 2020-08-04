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

function findVirtualPaths(root) {
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


class VFS {
  constructor(p, Native) {
    this.root = path.resolve(p);
    this.native = Native;
    this.watchers = [];
  }

  transpose(rawPath, resolvedPath, p) {
    const transposePath = rawPath + p.substr(resolvedPath.length);
    return transposePath;
  }

  /**
   * build raw and resolved path mapping
   * @param {*} root
   */
  buildPathMap() {
    const pathMap = new Map();
    this.resolvedRoot = resolveVirtual(this.root);
    pathMap.set(this.resolvedRoot, this.root);
    if (!path.extname(this.root)) {
      // find all direct virtual paths for given root.
      const virtualPaths = findVirtualPaths(this.root);
      virtualPaths.forEach((virtualPath) => {
        const resolvedVirtual = resolveVirtual(virtualPath);
        if (resolvedVirtual.indexOf(this.resolvedRoot) < 0) {
          pathMap.set(resolvedVirtual, virtualPath);
        }
      });
    }
    return pathMap;
  }

  watch(handler) {
    const pathMap = this.buildPathMap();
    pathMap.forEach((virtualPath, resolvedPath) => {
      const watcher = this.native.start(resolvedPath, (p, ...args) => {
        return handler(this.transpose(virtualPath, resolvedPath, p), ...args);
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
    this.resolvedRoot = undefined;
    return results[0];
  }
}

module.exports = VFS;
