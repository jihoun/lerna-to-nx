import {
  SchematicContext,
  SchematicsException,
  Tree,
  Rule,
} from "@angular-devkit/schematics";
import {
  addPackageJsonDependency,
  NodeDependencyType,
} from "@schematics/angular/utility/dependencies";
import { findPropertyInAstObject } from "@schematics/angular/utility/json-utils";
import { Observable, of } from "rxjs";
import { concatMap, map } from "rxjs/operators";
import { parseJsonAtPath } from "./utility";
import { get } from "http";
import { JsonAstObject } from "@angular-devkit/core";
import { IAngularWorkspace } from ".";

export enum Configs {
  JsonIndentLevel = 2,
}

export interface NodePackage {
  name: string;
  version: string;
}

export enum PkgJson {
  Path = "./package.json",
}

export interface DeleteNodeDependency {
  type: NodeDependencyType;
  name: string;
}

export function removeDependencies(
  tree: Tree,
  context: SchematicContext,
  dependencies: string[]
): Observable<Tree> {
  return of(...dependencies).pipe(
    map((packageName: string) => {
      context.logger.debug(`Removing ${packageName} dependency`);

      removePackageJsonDependency(tree, {
        type: NodeDependencyType.Dev,
        name: packageName,
      });

      return tree;
    })
  );
}

export function addDependencies(
  tree: Tree,
  context: SchematicContext,
  dependencies: string[]
): Observable<Tree> {
  return of(...dependencies).pipe(
    concatMap((packageName: string) => getLatestNodeVersion(packageName)),
    map((packageFromRegistry: NodePackage) => {
      const { name, version } = packageFromRegistry;
      context.logger.debug(
        `Adding ${name}:${version} to ${NodeDependencyType.Dev}`
      );

      addPackageJsonDependency(tree, {
        type: NodeDependencyType.Dev,
        name,
        version,
      });

      return tree;
    })
  );
}

// modified version from utility/dependencies/getPackageJsonDependency
export function removePackageJsonDependency(
  tree: Tree,
  dependency: DeleteNodeDependency
): void {
  const packageJsonAst = parseJsonAtPath(tree, PkgJson.Path);
  const depsNode = findPropertyInAstObject(packageJsonAst, dependency.type);
  const recorder = tree.beginUpdate(PkgJson.Path);

  if (!depsNode) {
    // Haven't found the dependencies key.
    throw new SchematicsException("Could not find the package.json dependency");
  } else if (depsNode.kind === "object") {
    const fullPackageString = depsNode.text.split("\n").filter((pkg) => {
      return pkg.includes(`"${dependency.name}"`);
    })[0];

    const commaDangle =
      fullPackageString && fullPackageString.trim().slice(-1) === "," ? 1 : 0;

    const packageAst = depsNode.properties.find((node) => {
      return node.key.value.toLowerCase() === dependency.name.toLowerCase();
    });

    // TODO: does this work for the last dependency?
    const newLineIndentation = 0;

    if (packageAst) {
      // Package found, remove it.
      const end = packageAst.end.offset + commaDangle;

      recorder.remove(
        packageAst.key.start.offset,
        end - packageAst.start.offset + newLineIndentation
      );
    }
  }

  tree.commitUpdate(recorder);
}

export function addPropertyToPackageJson(
  tree: Tree,
  context: SchematicContext,
  propertyName: string,
  propertyValue: { [key: string]: any }
) {
  const pkgJsonBuffer = tree.read(PkgJson.Path);
  if (!pkgJsonBuffer) {
    throw new SchematicsException("Not a lerna workspace");
  }

  const pkgJson = JSON.parse(pkgJsonBuffer.toString());
  let node = pkgJson[propertyName];
  if (!pkgJson[propertyName]) {
    context.logger.debug(`Creating section ${propertyName} in package.json`);
    node = {};
    pkgJson[propertyName] = node;
  }
  for (let [key, value] of Object.entries(
    propertyValue
  ).sort(([a, _va]: [string, any], [b, _vb]: [string, any]) =>
    a.localeCompare(b)
  )) {
    if (!node[key]) {
      context.logger.debug(`adding ${key} with ${value}`);
    } else {
      context.logger.debug(`overwriting ${key} with ${value}`);
    }
    node[key] = value;
  }
  tree.overwrite(
    PkgJson.Path,
    JSON.stringify(pkgJson, null, Configs.JsonIndentLevel)
  );
}

/**
 * Attempt to retrieve the latest package version from NPM
 * Return an optional "latest" version in case of error
 * @param packageName
 */
export function getLatestNodeVersion(
  packageName: string
): Promise<NodePackage> {
  const DEFAULT_VERSION = "latest";

  return new Promise((resolve) => {
    return get(`http://registry.npmjs.org/${packageName}`, (res) => {
      let rawData = "";
      res.on("data", (chunk) => (rawData += chunk));
      res.on("end", () => {
        try {
          const response = JSON.parse(rawData);
          const version = (response && response["dist-tags"]) || {};

          resolve(buildPackage(packageName, version.latest));
        } catch (e) {
          resolve(buildPackage(packageName));
        }
      });
    }).on("error", () => resolve(buildPackage(packageName)));
  });

  function buildPackage(
    name: string,
    version: string = DEFAULT_VERSION
  ): NodePackage {
    return { name, version };
  }
}

export function mergePackageJson(
  tree: Tree,
  context: SchematicContext,
  jsonAst: JsonAstObject,
  whitelist: string[]
): Tree {
  ["dependencies", "peerDependencies"].forEach((dependencyType) => {
    const node = findPropertyInAstObject(jsonAst, dependencyType);
    if (node?.kind === "object") {
      addPropertyToPackageJson(
        tree,
        context,
        "dependencies",
        pluckKeys(node.value, whitelist)
      );
    }
  });
  const node = findPropertyInAstObject(jsonAst, "devDependencies");
  if (node?.kind === "object") {
    addPropertyToPackageJson(
      tree,
      context,
      "devDependencies",
      pluckKeys(node.value, whitelist)
    );
  }
  return tree;
}

function pluckKeys(
  obj: { [k: string]: any },
  keys: string[]
): { [k: string]: any } {
  const res: { [k: string]: any } = { ...obj };
  keys.forEach((key) => {
    if (res[key]) {
      delete res[key];
    }
  });
  return res;
}
export function mergePackageJsonFiles(
  angularPackagesPath: IAngularWorkspace[]
): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    const whitelist = angularPackagesPath.map((pack) => pack.packageName);
    angularPackagesPath.forEach((pack) => {
      tree = mergePackageJson(tree, context, pack.packageJson, whitelist);
      tree.rename(
        `${pack.path}/package.json`,
        `${pack.path}/package.json.${new Date().getTime()}~`
      );
    });
    return tree;
  };
}
