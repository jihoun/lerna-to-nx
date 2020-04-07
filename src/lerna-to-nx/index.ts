import { JsonAstNode, JsonAstObject } from "@angular-devkit/core";
import { WorkspaceSchema } from "@angular-devkit/core/src/experimental/workspace";
import {
  chain,
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
} from "@angular-devkit/schematics";
import { NodePackageInstallTask } from "@angular-devkit/schematics/tasks";
import { findPropertyInAstObject } from "@schematics/angular/utility/json-utils";
import * as glob from "glob";
import { concat, Observable } from "rxjs";
import { createNxFile } from "./nx";
import {
  addDependencies,
  mergePackageJsonFiles,
  removeDependencies,
} from "./package-json";
import { updateTsConfigFiles } from "./ts-config";
import { parseJsonAtPath } from "./utility";
import { getWorkspace, mergeAngularJsonFiles } from "./workspace";

export interface IAngularWorkspace {
  path: string;
  workspace?: WorkspaceSchema;
  packageJson: JsonAstObject;
  packageName: string;
}

// You don't have to export the function as default. You can also have more than one rule factory
// per file.
export function lernaToNx(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    const lernaConfigBuffer = tree.read("lerna.json");
    if (!lernaConfigBuffer) {
      throw new SchematicsException("Not a lerna workspace");
    }

    const lernaConfig = JSON.parse(lernaConfigBuffer.toString());
    const lernaPackages: string[] = lernaConfig.packages;
    let packagesPath: string[] = [];
    lernaPackages.forEach((gl) => {
      packagesPath = [...packagesPath, ...glob.sync(gl)];
    });

    const packages: IAngularWorkspace[] = packagesPath.map((path) => {
      let workspace: WorkspaceSchema | undefined;
      if (tree.exists(`${path}/angular.json`)) {
        workspace = getWorkspace(tree, path);
      }
      let packageJson = parseJsonAtPath(tree, `${path}/package.json`);
      let nodeName: JsonAstNode | null = findPropertyInAstObject(
        packageJson,
        "name"
      );
      let packageName = "";
      if (nodeName?.kind === "string") {
        packageName = nodeName.value;
      }
      return { path, workspace, packageJson, packageName };
    });

    return chain([
      mergePackageJsonFiles(packages),
      // updateDependencies(),
      mergeAngularJsonFiles(packages.filter((pack) => pack.workspace)),
      createNxFile(packages, "perxtech"), //TODO fetch it from package.json
      updateTsConfigFiles(packages),
    ])(tree, _context);
  };
}

export function updateDependencies(): Rule {
  return (tree: Tree, context: SchematicContext): Observable<Tree> => {
    context.logger.debug("Updating dependencies...");
    context.addTask(new NodePackageInstallTask());
    return concat(
      removeDependencies(tree, context, ["lerna"]),
      addDependencies(tree, context, ["@nrwl/workspace"])
    );
  };
}
