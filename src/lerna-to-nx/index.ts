import {
  WorkspaceSchema,
  WorkspaceProject
} from "@angular-devkit/core/src/experimental/workspace";
import {
  chain,
  Rule,
  SchematicContext,
  SchematicsException,
  Tree
} from "@angular-devkit/schematics";
import { NodePackageInstallTask } from "@angular-devkit/schematics/tasks";
import * as glob from "glob";
import { concat, Observable } from "rxjs";
import { addDependencies, removeDependencies } from "./package-json";
import { getWorkspace, mergeWorkspace, moveWorkspace } from "./workspace";
import { parseJson, JsonParseMode } from "@angular-devkit/core";

interface IAngularWorkspace {
  path: string;
  workspace: WorkspaceSchema;
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
    lernaPackages.forEach(gl => {
      packagesPath = [...packagesPath, ...glob.sync(gl)];
    });

    const angularPackages: IAngularWorkspace[] = packagesPath
      .filter(path => tree.exists(`${path}/angular.json`))
      .map(path => {
        let workspace = getWorkspace(tree, path);
        return { path, workspace };
      });

    return chain([
      // updateDependencies(),
      mergeAngularJsonFiles(angularPackages),
      createNxFile(angularPackages),
      updateTsConfigFiles(angularPackages)
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

function mergeAngularJsonFiles(angularPackagesPath: IAngularWorkspace[]): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.debug(
      "Merging packages angular.json into master angular.json..."
    );
    const workspace: WorkspaceSchema = {
      $schema: "./node_modules/@angular/cli/lib/config/schema.json",
      version: 1,
      projects: {}
    };
    angularPackagesPath.forEach((pack: IAngularWorkspace) => {
      importAngularProject(tree, context, pack, workspace);
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
  const packageWorkspace = moveWorkspace(pack.workspace, pack.path);
  master = mergeWorkspace(packageWorkspace, master);
  return { tree, workspace: master };
}

function createNxFile(angularPackagesPath: IAngularWorkspace[]): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.debug("Creating nx.json file...");
    const nxJson: any = {
      // "npmScope": "myorg",
      implicitDependencies: {
        "angular.json": "*",
        "package.json": {
          dependencies: "*",
          devDependencies: "*"
        },
        "tsconfig.json": "*",
        "tslint.json": "*",
        "nx.json": "*"
      },
      projects: {}
    };
    angularPackagesPath.forEach(pack => {
      for (let key in pack.workspace.projects) {
        nxJson.projects[key] = {
          tags: []
        };
      }
    });

    tree.create("nx.json", JSON.stringify(nxJson, null, 2));
    return tree;
  };
}

function updateTsConfigFiles(angularPackagesPath: IAngularWorkspace[]): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.info("Updating tsconfig files...");
    const tsconfigJson = {
      compileOnSave: false,
      compilerOptions: {
        rootDir: ".",
        sourceMap: true,
        declaration: false,
        moduleResolution: "node",
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
        importHelpers: true,
        target: "es2015",
        module: "esnext",
        typeRoots: ["node_modules/@types"],
        lib: ["es2017", "dom"],
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        baseUrl: ".",
        paths: {}
      },
      exclude: ["node_modules", "tmp"]
    };
    angularPackagesPath.forEach(pack => {
      Object.entries(pack.workspace.projects)
        .filter(
          ([_key, value]: [string, WorkspaceProject]) =>
            value.projectType === "library"
        )
        .filter(
          ([_key, value]: [string, WorkspaceProject]) =>
            value?.architect?.build?.options?.project
        )
        .forEach(([key, value]: [string, WorkspaceProject]) => {
          const ngPackagePath: string =
            value?.architect?.build?.options?.project;
          if (!ngPackagePath) {
            throw new SchematicsException(
              `Could not access 'architect.build.options.project'`
            );
          }
          const ngPackageDir = ngPackagePath
            .split("/")
            .slice(0, -1)
            .join("/");
          console.log(`${ngPackagePath}`);
          const ngPackageBuffer = tree.read(ngPackagePath);
          if (ngPackageBuffer === null) {
            throw new SchematicsException(`Could not find (${ngPackagePath})`);
          }
          const ngPackageStr = ngPackageBuffer.toString();

          const ngPackage = parseJson(ngPackageStr, JsonParseMode.Loose) as any;
          const entryFile = ngPackage.lib.entryFile;
          // @ts-ignore
          tsconfigJson.compilerOptions.paths[key] = [
            `${ngPackageDir}/${entryFile}`
          ];
        });
    });
    tree.create("tsconfig.json", JSON.stringify(tsconfigJson, null, 2));
    return tree;
  };
}
