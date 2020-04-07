import { IAngularWorkspace } from ".";
import { Rule, SchematicContext } from "@angular-devkit/schematics";
import { Tree } from "@angular-devkit/schematics/src/tree/interface";

export function createNxFile(
  angularPackagesPath: IAngularWorkspace[],
  namespace: string
): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.debug("Creating nx.json file...");
    const nxJson: any = {
      npmScope: namespace,
      implicitDependencies: {
        "angular.json": "*",
        "package.json": "*", // {
        //   dependencies: "*",
        //   devDependencies: "*",
        // },
        "tsconfig.json": "*",
        "tslint.json": "*",
        "nx.json": "*",
      },
      projects: {},
    };
    angularPackagesPath
      .filter((pack) => pack.workspace)
      .forEach((pack) => {
        // @ts-ignore ignore the warning on workspace as we have been filtering it out in previous line
        for (let key in pack.workspace.projects) {
          nxJson.projects[key] = {
            tags: [],
          };
        }
      });

    tree.create("nx.json", JSON.stringify(nxJson, null, 2));
    return tree;
  };
}
