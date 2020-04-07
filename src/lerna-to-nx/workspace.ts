import { JsonParseMode, parseJson } from "@angular-devkit/core";
import {
  WorkspaceSchema,
  WorkspaceProject,
} from "@angular-devkit/core/src/experimental/workspace";
import {
  SchematicsException,
  Tree,
  Rule,
  SchematicContext,
} from "@angular-devkit/schematics";
import { IAngularWorkspace } from ".";
// import { JestOptions } from "./utility";

export enum Paths {
  AngularJson = "./angular.json",
}

function getWorkspacePath(tree: Tree, dir: string): string {
  const possibleFiles = [
    "/angular.json",
    "/.angular.json",
    "/angular-cli.json",
  ].map((p) => `${dir}${p}`);
  const path = possibleFiles.filter((path) => tree.exists(path))[0];

  return path;
}

export function getWorkspace(tree: Tree, dir: string = ""): WorkspaceSchema {
  const path = getWorkspacePath(tree, dir);
  const configBuffer = tree.read(path);
  if (configBuffer === null) {
    throw new SchematicsException(`Could not find (${path})`);
  }
  const content = configBuffer.toString();

  return (parseJson(content, JsonParseMode.Loose) as {}) as WorkspaceSchema;
}

// export function getWorkspaceConfig(tree: Tree, options: JestOptions) {
//   const workspace = getWorkspace(tree);
//   const workspacePath = getWorkspacePath(tree);
//   let projectName;
//   let projectProps;

//   if (options.__version__ >= 6) {
//     projectName = options.project || workspace.defaultProject || "";
//     projectProps = workspace.projects[projectName];
//   } else if (options.__version__ < 6) {
//     projectName = (workspace as any).project.name || "";
//     projectProps = (workspace as any).apps[0];
//   }

//   return { projectProps, workspacePath, workspace, projectName };
// }

// /**
//  * Angular5 (angular-cli.json) config is formatted into an array of applications vs Angular6's (angular.json) object mapping
//  * multi-app Angular5 apps are currently not supported.
//  *
//  * @param tree
//  * @param options
//  */
// export function isMultiAppV5(tree: Tree, options: JestOptions) {
//   const config = getWorkspaceConfig(tree, options);

//   return options.__version__ < 6 && (config.workspace as any).apps.length > 1;
// }

export function mergeWorkspace(
  source: WorkspaceSchema,
  dest: WorkspaceSchema
): WorkspaceSchema {
  dest.projects = { ...source.projects, ...dest.projects };
  ["cli", "schematics", "architect", "targets"].forEach((key) => {
    // @ts-ignore
    if (source[key] !== undefined) {
      // @ts-ignore
      if (dest[key] === undefined) {
        // @ts-ignore
        dest[key] = {};
      }
      // @ts-ignore
      dest[key] = { ...source[key], ...dest[key] };
    }
  });
  return dest;
}

export function moveWorkspace(
  workspace: WorkspaceSchema,
  path: string
): WorkspaceSchema {
  for (let key in workspace.projects) {
    workspace.projects[key] = moveWorkspaceProject(
      workspace.projects[key],
      path
    );
  }
  return workspace;
}

function moveWorkspaceProject(project: WorkspaceProject, path: string) {
  project.root = prependPath(path, project.root);
  if (project.sourceRoot) {
    project.sourceRoot = prependPath(path, project.sourceRoot);
  }
  if (project?.architect) {
    // @ts-ignore
    for (let key in project.architect) {
      let architect = project.architect[key];
      if (architect?.options.tsConfig) {
        architect.options.tsConfig = genericPrependPath(
          path,
          architect.options.tsConfig
        );
      }
      if (architect?.options.project) {
        architect.options.project = genericPrependPath(
          path,
          architect.options.project
        );
      }
      if (architect?.options.index) {
        architect.options.index = genericPrependPath(
          path,
          architect.options.index
        );
      }
      if (architect?.options.main) {
        architect.options.main = genericPrependPath(
          path,
          architect.options.main
        );
      }
      if (architect?.options.polyfills) {
        architect.options.polyfills = genericPrependPath(
          path,
          architect.options.polyfills
        );
      }
      if (architect?.options.assets) {
        architect.options.assets = genericPrependPath(
          path,
          architect.options.assets
        );
      }
      if (architect?.options.styles) {
        architect.options.styles = genericPrependPath(
          path,
          architect.options.styles
        );
      }
      if (architect?.options.protractorConfig) {
        architect.options.protractorConfig = genericPrependPath(
          path,
          architect.options.protractorConfig
        );
      }
      if (architect?.configurations) {
        for (let configKey in architect.configurations) {
          let config = architect.configurations[configKey];
          if (config.fileReplacements) {
            config.fileReplacements = config?.fileReplacements.map(
              (r: any) => ({
                replace: prependPath(path, r.replace),
                with: prependPath(path, r.with),
              })
            );
          }
        }
      }
    }
  }
  return project;
}

function prependPath(prefix: string, path: string): string {
  if (path === "") {
    return prefix;
  }
  return `${prefix}/${path}`;
}

function prependPathOnArray(
  prefix: string,
  path: (string | { [k: string]: string })[]
): (string | { [k: string]: string })[] {
  return path.map((p) => {
    if (typeof p === "string") {
      return prependPath(prefix, p);
    }
    return prependPathOnObject(prefix, p);
  });
}

function prependPathOnObject(
  prefix: string,
  path: { [k: string]: string }
): { [k: string]: string } {
  for (let key in path) {
    path[key] = prependPath(prefix, path[key]);
  }
  return path;
}

function genericPrependPath(
  prefix: string,
  path: string | (string | { [k: string]: string })[]
): string | (string | { [k: string]: string })[] {
  if (Array.isArray(path)) {
    return prependPathOnArray(prefix, path);
  }
  return prependPath(prefix, path);
}

export function mergeAngularJsonFiles(
  angularPackagesPath: IAngularWorkspace[]
): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.debug(
      "Merging packages angular.json into master angular.json..."
    );
    const workspace: WorkspaceSchema = {
      $schema: "./node_modules/@angular/cli/lib/config/schema.json",
      version: 1,
      projects: {},
    };
    angularPackagesPath.forEach((pack: IAngularWorkspace) => {
      importAngularProject(tree, context, pack, workspace);
      tree.delete(`${pack.path}/angular.json`);
    });
    tree.create("angular.json", JSON.stringify(workspace, null, 2));
    return tree;
  };
}

function importAngularProject(
  tree: Tree,
  _context: SchematicContext,
  pack: IAngularWorkspace,
  master: WorkspaceSchema
  // nxJson: any
): { tree: Tree; workspace: WorkspaceSchema } {
  if (!pack.workspace) {
    throw new SchematicsException(
      "should not call this method without angular workspace"
    );
  }
  const packageWorkspace = moveWorkspace(pack.workspace, pack.path);
  master = mergeWorkspace(packageWorkspace, master);
  return { tree, workspace: master };
}
