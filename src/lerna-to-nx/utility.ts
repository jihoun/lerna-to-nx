import {
  join,
  JsonAstObject,
  JsonParseMode,
  parseJsonAst,
  Path
} from "@angular-devkit/core";
import { SchematicsException, Tree } from "@angular-devkit/schematics";
import { getPackageJsonDependency } from "@schematics/angular/utility/dependencies";
import { getWorkspace } from "./workspace";

// export interface JestOptions {
//   updateTests?: boolean;
//   project?: string;
//   config?: "file" | "packagejson" | string;
//   overwrite?: boolean;
//   __version__: number;
// }

export function getAngularVersion(tree: Tree): number {
  const packageNode = getPackageJsonDependency(tree, "@angular/core");

  const version =
    packageNode &&
    packageNode.version.split("").find(char => !!parseInt(char, 10));

  return version ? +version : 0;
}

export function getSourcePath(tree: Tree, options: any): String {
  const workspace = getWorkspace(tree);

  if (!options.project) {
    throw new SchematicsException('Option "project" is required.');
  }

  const project = workspace.projects[options.project];

  if (project.projectType !== "application") {
    throw new SchematicsException(
      `AddJest requires a project type of "application".`
    );
  }

  // const assetPath = join(project.root as Path, 'src', 'assets');
  const sourcePath = join(project.root as Path, "src");

  return sourcePath;
}

export function safeFileDelete(tree: Tree, path: string): boolean {
  if (tree.exists(path)) {
    tree.delete(path);
    return true;
  } else {
    return false;
  }
}

export function parseJsonAtPath(tree: Tree, path: string): JsonAstObject {
  const buffer = tree.read(path);

  if (buffer === null) {
    throw new SchematicsException("Could not read package.json.");
  }

  const content = buffer.toString();

  const json = parseJsonAst(content, JsonParseMode.Strict);
  if (json.kind != "object") {
    throw new SchematicsException(
      "Invalid package.json. Was expecting an object"
    );
  }

  return json;
}
