import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as glob from 'glob';
import { create } from 'domain';

interface Dictionary<Type> {
  [key: string]: Type;
}

export class rokuBuilderTaskProvider implements vscode.TaskProvider {
  static buildScriptType = 'rokubuilder';
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Roku Builder Log");
  }

  public async provideTasks(): Promise<vscode.Task[]> {
    let tasks: vscode.Task[] | undefined;

    console.log("Provide Tasks");

    tasks = []

		return tasks;
	}

  public resolveTask(_task: vscode.Task): vscode.Task | undefined {
    console.log("Resolve Task", _task.definition)
    if (_task) {
		  return this.getTask(_task)
    } else {
      return undefined;
    }
	}

  private getTask(_task: vscode.Task | undefined) : vscode.Task | undefined {
    if (!_task?.scope) {
      return undefined;
    }
    const scope: vscode.WorkspaceFolder = <vscode.WorkspaceFolder>_task?.scope

    return new vscode.Task(_task.definition, scope, "Roku Builder", rokuBuilderTaskProvider.buildScriptType, new vscode.CustomExecution(async (resolveDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> => {
      console.log(resolveDefinition);
      const definition : rokuBuilderTaskDefinition = resolveDefinition;

      // When the task is executed, this callback will run. Here, we setup for running the task.
      return new CustomBuildTaskTerminal(scope, definition.brand, definition.targetDir);
    }));
  }
}

interface rokuBuilderTaskDefinition extends vscode.TaskDefinition {
	brand?: string;
  targetDir?: string;
}

interface rokuBuilderFileInfo {
  relativeFilePath: string;
  absoluteFilePath: string;
}

class CustomBuildTaskTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	private closeEmitter = new vscode.EventEmitter<number>();
	onDidClose?: vscode.Event<number> = this.closeEmitter.event;
  private configData: Dictionary<any> = {};
  private targetDir: string;

  constructor(private taskScope: vscode.WorkspaceFolder, private requestedBrand: string | undefined, targetDir: string | undefined) {
    if (!targetDir) {
      this.targetDir = taskScope.uri.fsPath
    } else {
      this.targetDir = targetDir;
    }
  }

  open(initialDimensions: vscode.TerminalDimensions): void {
    this.doBuild()
  }
  close(): void {}

  private async doBuild(): Promise<void> {
    if (!this.taskScope) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.writeEmitter.fire('Starting build...\r\n');

      const folder = this.taskScope;
      const config = path.join(folder.uri.fsPath, ".roku_builder_rebrand.json");
      let availableBrands: Array<string> = []

      if (!fs.existsSync(config)) {
        console.log("Roku Builder not found for", folder);
        return;
      }

      this.configData = JSON.parse(fs.readFileSync(config).toString());

      if (!this.configData) {
        console.log("Roku Builder config is invalid", folder);
        return;
      }

      console.log("Config loaded", folder, this.configData);

      if (this.requestedBrand) {
        console.log(`Brand ${this.requestedBrand} requested`);
        this.buildBrand(this.requestedBrand, this.configData);
      } else {
        console.log("Brand missing, scanning config");
        const availableBrands: Array<string> = this.loadBrands(this.configData);

        vscode.window.showQuickPick(availableBrands).then((value: string | undefined) => {
          if (value) {
            this.buildBrand(value, this.configData);
          }
        })
      }

      this.closeEmitter.fire(0);
      resolve();
    })
  }

  private loadBrands(configData: Dictionary<any>): Array<string> {
    let availableBrands: Array<string> = [];

    if (configData.brands) {
      Object.entries(configData.brands).forEach(([key, value]) => {
        if (!key.startsWith("!")) {
          availableBrands.push(key);
        }
      });

      if (configData.brands["!repeat_brands"]) {
        try {
          const topBrands = configData.brands["!repeat_brands"]["for"];

          topBrands.forEach((currentTopBrand: string) => {
            let variables: Dictionary<string> = {};

            variables["key"] = currentTopBrand;
            if (configData.brands["!repeat_brands"]["replace"]) {
              let replaceVariables: Dictionary<any> = configData.brands["!repeat_brands"]["replace"];

              Object.entries(replaceVariables).forEach(([key, value]) => {
                variables[key] = value[0]
              })
            }

            const subBrands = configData.brands["!repeat_brands"]["brands"];
            const variableRegEx = /{(\w+)}/i

            Object.entries(subBrands).forEach(([key, value]) => {
              let brand = key.replace(variableRegEx, (match, g1) => {
                console.log("match", g1, variables[g1]);
                return variables[g1]
              })

              availableBrands.push(brand);
            })
          })
        } catch(e) {
          console.log(e)
        }
      } else {
        console.log("Repeat not found")
      }
    }

    console.log(availableBrands);

    return availableBrands;
  }

  private buildBrand(requestedBrand: string, configData: any) {
    let brandConfigs: Dictionary<any> = {};

    if (configData.brands) {
      if (configData.brands[requestedBrand]) {
        console.log("Brand found directly, processing")
      } else {
        let targets = configData.targets;
        Object.entries(configData.brands).forEach(([key, value]) => {
        if (!key.startsWith("!")) {
          const typedValue: Dictionary<any> = <Dictionary<any>>value;

          if (typedValue.targets) {
            targets = configData.targets.concat(typedValue.targets)
          }
          brandConfigs[key] = value;
          brandConfigs[key]["!files"] = [];

          let matches = glob.sync(path.join(this.taskScope.uri.fsPath, "brands", key, "{" + targets.join(",") + "}{/**/*,*}"), {nodir: true})
          matches.forEach((value) => {
            let fileInfo: rokuBuilderFileInfo = {
              absoluteFilePath: value,
              relativeFilePath: path.relative(path.join(this.taskScope.uri.fsPath, "brands", key), value)
            };

            brandConfigs[key]["!files"].push(fileInfo);
          })

          brandConfigs[key]["!config"] = this.parseConfig(key);
        }
      });

      if (configData.brands["!repeat_brands"]) {
        try {
          const topBrands = configData.brands["!repeat_brands"]["for"];

          topBrands.forEach((currentTopBrand: string) => {
            let variables: Dictionary<string> = {};

            variables["key"] = currentTopBrand;
            if (configData.brands["!repeat_brands"]["replace"]) {
              let replaceVariables: Dictionary<any> = configData.brands["!repeat_brands"]["replace"];

              Object.entries(replaceVariables).forEach(([key, value]) => {
                variables[key] = value[0]
              })
            }

            const subBrands = configData.brands["!repeat_brands"]["brands"];

            Object.entries(subBrands).forEach(([key, value]) => {
              let brand = this.replaceVariables(key, variables);
              let targets = configData.targets;
              const typedValue: Dictionary<any> = <Dictionary<any>>value;

              if (typedValue.targets) {
                targets = configData.targets.concat(typedValue.targets)
              }

              brandConfigs[brand] = value
              brandConfigs[brand]["!variables"] = variables;
              brandConfigs[brand]["!files"] = [];

              const matches = glob.sync(path.join(this.taskScope.uri.fsPath, "brands", brand, "{" + targets.join(",") + "}{/**/*,*}"), {nodir: true})
              matches.forEach((value) => {
                let fileInfo: rokuBuilderFileInfo = {
                  absoluteFilePath: value,
                  relativeFilePath: path.relative(path.join(this.taskScope.uri.fsPath, "brands", brand), value)
                };

                brandConfigs[brand]["!files"].push(fileInfo);
              })

              brandConfigs[brand]["!config"] = this.parseConfig(brand);
            })
          })

          if (brandConfigs[requestedBrand]) {
            let finalConfig: Dictionary<any> = this.processBrand(brandConfigs[requestedBrand], brandConfigs);

            if (!fs.existsSync(this.targetDir)) {
              fs.mkdirSync(this.targetDir);
            }

            finalConfig["!files"].forEach((sourceFile: rokuBuilderFileInfo) => {
              const content = fs.readFileSync(sourceFile.absoluteFilePath);
              const targetFilePath = path.join(this.targetDir, sourceFile.relativeFilePath);
              const targetFileInfo = path.parse(targetFilePath)

              fs.mkdirSync(targetFileInfo.dir, {recursive: true});
              fs.writeFileSync(targetFilePath, content, {flag: "w"});
            })
            let manifest: string = ""

            Object.entries(finalConfig["manifest"]).forEach(([key, value]) => {
              let typeValue: any = value;

              if (typeof typeValue === "object") {
                let valueConcat: string[] = [];

                Object.entries(typeValue).forEach(([key, value]) => {
                  valueConcat.push(key + "=" + value)
                })
                manifest += key + "=" + valueConcat.join(";") + "\r\n";
              } else {
                manifest += key + "=" + typeValue.toString() + "\r\n"
              }
            })
            fs.writeFileSync(path.join(this.targetDir, "manifest"), manifest)

            if (this.configData["resolutions"]) {
              this.configData["resolutions"].forEach((resolution: string) => {
                Object.entries(finalConfig["!config"]).forEach(([region, regionValue]) => {
                  const createdConfig = this.createConfig(<Dictionary<any>>regionValue, resolution)
                  const filePath = path.join(this.targetDir, "region", region)

                  fs.mkdirSync(filePath, {recursive: true});
                  fs.writeFileSync(path.join(filePath, "production_" + resolution + ".json"), JSON.stringify(createdConfig));
                  fs.writeFileSync(path.join(filePath, "staging_" + resolution + ".json"), JSON.stringify(createdConfig));
                })
              })
            } else {
              Object.entries(finalConfig["!config"]).forEach(([region, regionValue]) => {
                const createdConfig = this.createConfig(<Dictionary<any>>regionValue, "fhd")
                const filePath = path.join(this.targetDir, "region", region)

                fs.mkdirSync(filePath, {recursive: true});
                fs.writeFileSync(path.join(filePath, "production.json"), JSON.stringify(createdConfig));
                fs.writeFileSync(path.join(filePath, "staging.json"), JSON.stringify(createdConfig));
              })
            }

            console.log(finalConfig);
          } else {
            console.log(`Requested brand ${requestedBrand} not found`);
          }
        } catch(e) {
          console.log(e)
        }
      } else {
        console.log("Repeat not found")
      }
      }
    }
  }

  private processBrand(currentBrand: Dictionary<any>, brandConfigs: Dictionary<any>): Dictionary<any> {
    let currentConfig: Dictionary<any> = {};

    console.log("processBrand", currentBrand)

    if (currentBrand.parents) {
      currentBrand.parents.forEach((parentBrand: string) => {
        let resolvedBrand: string = parentBrand;
        if (currentBrand["!variables"]) {
          resolvedBrand = this.replaceVariables(parentBrand, currentBrand["!variables"])
        }
        const parentConfig: Dictionary<any> = this.processBrand(brandConfigs[resolvedBrand], brandConfigs);
        Object.entries(parentConfig).forEach(([key, value]) => {
          currentConfig[key] = value
        })
      })
    }

    if (currentBrand["manifest"]) {
      if (!currentConfig["manifest"]) {
        currentConfig["manifest"] = {}
      }

      Object.entries(currentBrand["manifest"]).forEach(([key, value]) => {
        if (typeof value  === "string") {
          currentConfig["manifest"][key] = this.replaceVariables(<string>value, currentBrand["!variables"])
        } else if (typeof value === "object") {
          if (!currentConfig["manifest"][key]) {
            currentConfig["manifest"][key] = {}
          }
          Object.entries(<object>value).forEach(([objKey, objValue]) => {
            currentConfig["manifest"][key][objKey] = objValue;
          })
        } else {
          currentConfig["manifest"][key] = value;
        }
      });
    }

    if (currentBrand["signing_key"]) {
      currentConfig["signing_key"] = this.replaceVariables(currentBrand["signing_key"], currentBrand["!variables"])
    }

    if (currentBrand["targets"]) {
      currentConfig["targets"] = currentBrand["targets"]
    }

    if (currentBrand["replacement_files"]) {
      currentConfig["replacement_files"] = currentBrand["replacement_files"]
    }

    if (currentBrand["!files"]) {
      if (!currentConfig["!files"]) {
        currentConfig["!files"] = []
      }

      Object.entries(currentBrand["!files"]).forEach(([key, value]) => {
        value as rokuBuilderFileInfo
        currentConfig["!files"].push(value);
      });
    }

    if (currentBrand["!config"]) {
      if (!currentConfig["!config"]) {
        currentConfig["!config"] = {}
      }

      Object.entries(currentBrand["!config"]).forEach(([key, value]) => {
        currentConfig["!config"][key] = value;
      });
    }

    console.log(currentConfig);

    return currentConfig;
  }

  private parseConfig(brand: string) {
    let config: Dictionary<any> = {}
    let matches = glob.sync(path.join(this.taskScope.uri.fsPath, "brands", brand, "region/*"))
    matches.forEach((regionPath) => {
      const region = path.relative(path.join(this.taskScope.uri.fsPath, "brands", brand, "region"), regionPath)
      config[region] = {}

      const configPath = path.join(regionPath, "config.json")

      if (fs.existsSync(configPath)) {
        const regionConfigData = JSON.parse(fs.readFileSync(configPath).toString());

        config[region] = regionConfigData;

        const configSections = this.configData["channel_config_sections"];
        const configMatches = glob.sync(path.join(regionPath, "configs/{" + configSections.join(",") + "}/**/*"))
        configMatches.forEach((regionConfigPath) => {
          const basePath = path.relative(path.join(regionPath, "configs"), regionConfigPath)
          const basePathParts = path.dirname(basePath);

          if (!config[region]["components"]) {
            config[region]["components"] = {
              "subType": "node"
            }
          }

          if (!config[region]["components"][basePathParts]) {
            config[region]["components"][basePathParts] = {}
          }

          const componentConfig = JSON.parse(fs.readFileSync(regionConfigPath).toString());

          Object.entries(componentConfig).forEach(([componentKey, componentValue]) => {
            config[region]["components"][basePathParts][componentKey] = componentValue
          })
        })
      }
    })

    return config
  }

  private createConfig(config: Dictionary<any>, resolution: string): Dictionary<any> {
    let createdConfig: Dictionary<any> = {}

    createdConfig = this.createConfigSection(config, resolution)

    return createdConfig
  }

  private createConfigSection(section: Dictionary<any>, resolution: string): Dictionary<any> {
    let createdSection: Dictionary<any> = {};

    Object.entries(section).forEach(([sectionKey, sectionValue]) => {
      if (Array.isArray(sectionValue)) {
        createdSection[sectionKey] = sectionValue
      } else  if (typeof sectionValue === "object") {
        if (sectionValue[resolution]) {
          if (Array.isArray(sectionValue[resolution])) {
            createdSection[sectionKey] = sectionValue[resolution]
          } else if (typeof sectionValue[resolution] === "object") {
            createdSection[sectionKey] = this.createConfigSection(sectionValue[resolution], resolution);
          } else {
            createdSection[sectionKey] = sectionValue[resolution]
          }
        } else {
          createdSection[sectionKey] = this.createConfigSection(sectionValue, resolution);
        }
      } else {
        createdSection[sectionKey] = sectionValue
      }
    })

    return createdSection;
  }

  private replaceVariables(original: string, variables: Dictionary<string>): string {
    if (variables) {
      return original.replace(/{(\w+)}/ig, (match, g1) => {
        if (variables[g1]) {
          return variables[g1]
        } else {
          return "{" + g1 + "}"
        }
      })
    } else {
      return original;
    }
  }
}