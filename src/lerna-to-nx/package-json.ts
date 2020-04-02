import {
  SchematicContext,
  SchematicsException,
  Tree
} from "@angular-devkit/schematics";
import {
  addPackageJsonDependency,
  NodeDependencyType
} from "@schematics/angular/utility/dependencies";
import {
  appendPropertyInAstObject,
  findPropertyInAstObject,
  insertPropertyInAstObjectInOrder
} from "@schematics/angular/utility/json-utils";
import { Observable, of } from "rxjs";
import { concatMap, map } from "rxjs/operators";
import { parseJsonAtPath } from "./utility";
import { get } from "http";

export enum Configs {
  JsonIndentLevel = 2
}

export interface NodePackage {
  name: string;
  version: string;
}

export enum pkgJson {
  Path = "./package.json"
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
        name: packageName
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
        version
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
  const packageJsonAst = parseJsonAtPath(tree, pkgJson.Path);
  const depsNode = findPropertyInAstObject(packageJsonAst, dependency.type);
  const recorder = tree.beginUpdate(pkgJson.Path);

  if (!depsNode) {
    // Haven't found the dependencies key.
    throw new SchematicsException("Could not find the package.json dependency");
  } else if (depsNode.kind === "object") {
    const fullPackageString = depsNode.text.split("\n").filter(pkg => {
      return pkg.includes(`"${dependency.name}"`);
    })[0];

    const commaDangle =
      fullPackageString && fullPackageString.trim().slice(-1) === "," ? 1 : 0;

    const packageAst = depsNode.properties.find(node => {
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
  const packageJsonAst = parseJsonAtPath(tree, pkgJson.Path);
  const pkgNode = findPropertyInAstObject(packageJsonAst, propertyName);
  const recorder = tree.beginUpdate(pkgJson.Path);

  if (!pkgNode) {
    // outer node missing, add key/value
    appendPropertyInAstObject(
      recorder,
      packageJsonAst,
      propertyName,
      propertyValue,
      Configs.JsonIndentLevel
    );
  } else if (pkgNode.kind === "object") {
    // property exists, update values
    for (let [key, value] of Object.entries(propertyValue)) {
      const innerNode = findPropertyInAstObject(pkgNode, key);

      if (!innerNode) {
        // script not found, add it
        context.logger.debug(`creating ${key} with ${value}`);

        insertPropertyInAstObjectInOrder(
          recorder,
          pkgNode,
          key,
          value,
          Configs.JsonIndentLevel
        );
      } else {
        // script found, overwrite value
        context.logger.debug(`overwriting ${key} with ${value}`);

        const { end, start } = innerNode;

        recorder.remove(start.offset, end.offset - start.offset);
        recorder.insertRight(start.offset, JSON.stringify(value));
      }
    }
  }

  tree.commitUpdate(recorder);
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

  return new Promise(resolve => {
    return get(`http://registry.npmjs.org/${packageName}`, res => {
      let rawData = "";
      res.on("data", chunk => (rawData += chunk));
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
