import { JsonAstNode, JsonParseMode, parseJson } from "@angular-devkit/core";
import { WorkspaceProject } from "@angular-devkit/core/src/experimental/workspace";
import {
  Rule,
  SchematicContext,
  SchematicsException,
} from "@angular-devkit/schematics";
import { Tree } from "@angular-devkit/schematics/src/tree/interface";
import {
  appendPropertyInAstObject,
  findPropertyInAstObject,
  removePropertyInAstObject,
} from "@schematics/angular/utility/json-utils";
import { IAngularWorkspace } from ".";
import { Configs } from "./package-json";
import { backwardPath, parseJsonAtPath } from "./utility";

export function updateTsConfigFiles(
  angularPackagesPath: IAngularWorkspace[]
): Rule {
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
        paths: {},
      },
      exclude: ["node_modules", "tmp"],
    };
    //extract entry points from library packages
    angularPackagesPath
      .filter((pack) => pack.workspace)
      .forEach((pack) => {
        // @ts-ignore ignore the warning on workspace as we have been filtering it out in previous line
        Object.values(pack.workspace.projects)
          .filter((value: WorkspaceProject) => value.projectType === "library")
          .filter(
            (value: WorkspaceProject) =>
              value?.architect?.build?.options?.project
          )
          .forEach((value: WorkspaceProject) => {
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
            // console.log(`${ngPackagePath}`);
            const ngPackageBuffer = tree.read(ngPackagePath);
            if (ngPackageBuffer === null) {
              throw new SchematicsException(
                `Could not find (${ngPackagePath})`
              );
            }
            const ngPackageStr = ngPackageBuffer.toString();

            const ngPackage = parseJson(
              ngPackageStr,
              JsonParseMode.Loose
            ) as any;
            const entryFile = ngPackage.lib.entryFile;
            // @ts-ignore
            tsconfigJson.compilerOptions.paths[pack.packageName] = [
              `${ngPackageDir}/${entryFile}`,
            ];
          });
      });
    tree.create("tsconfig.json", JSON.stringify(tsconfigJson, null, 2));
    //patch tsconfig in subdirectories
    angularPackagesPath.forEach((pack) => {
      const tsConfigPath = `${pack.path}/tsconfig.json`;
      if (tree.exists(tsConfigPath)) {
        const tsConfig = parseJsonAtPath(
          tree,
          tsConfigPath,
          JsonParseMode.Loose
        );
        const recorder = tree.beginUpdate(tsConfigPath);
        appendPropertyInAstObject(
          recorder,
          tsConfig,
          "extends",
          `${backwardPath(pack.path)}/tsconfig.json`,
          Configs.JsonIndentLevel
        );
        const compilerOptions: JsonAstNode | null = findPropertyInAstObject(
          tsConfig,
          "compilerOptions"
        );
        if (compilerOptions && compilerOptions.kind === "object") {
          removePropertyInAstObject(recorder, compilerOptions, "baseUrl");
        }
        tree.commitUpdate(recorder);
      }
    });
    return tree;
  };
}
