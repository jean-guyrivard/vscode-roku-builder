import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as glob from 'glob';
import * as JSON5 from 'json5'
import sharp from 'sharp';
import * as GIF from 'omggif';

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
      this.targetDir = path.join(taskScope.uri.fsPath, "dist")
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

    return new Promise<void>(async (resolve) => {
      this.writeEmitter.fire('Starting build...\r\n');

      const folder = this.taskScope;
      const config = path.join(folder.uri.fsPath, ".roku_builder_rebrand.json");
      let availableBrands: Array<string> = []

      if (!fs.existsSync(config)) {
        console.log("Roku Builder not found for", folder);
        return;
      }

      this.configData = JSON5.parse(fs.readFileSync(config).toString());

      if (!this.configData) {
        console.log("Roku Builder config is invalid", folder);
        return;
      }

      console.log("Config loaded", folder, this.configData);

      if (this.requestedBrand) {
        console.log(`Brand ${this.requestedBrand} requested`);
        await this.buildBrand(this.requestedBrand, this.configData);

        this.closeEmitter.fire(0);
        resolve();
      } else {
        console.log("Brand missing, scanning config");
        const availableBrands: Array<string> = this.loadBrands(this.configData);

        vscode.window.showQuickPick(availableBrands).then((value: string | undefined) => {
          if (value) {
            this.buildBrand(value, this.configData);
          }

          this.closeEmitter.fire(0);
          resolve();
        })
      }
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

  private async buildBrand(requestedBrand: string, configData: any) {
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

            let matches = glob.sync(path.join(this.taskScope.uri.fsPath, "brands", key, "{" + targets.join(",") + "}{/**/*,*}"), { nodir: true })
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

                const matches = glob.sync(path.join(this.taskScope.uri.fsPath, "brands", brand, "{" + targets.join(",") + "}{/**/*,*}"), { nodir: true })
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

              await this.finalizeBuild(finalConfig);


              console.log(finalConfig);
            } else {
              console.log(`Requested brand ${requestedBrand} not found`);
            }
          } catch (e) {
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
          if (currentConfig[key] != undefined) {
            currentConfig[key] = Object.assign(currentConfig[key], value)
          } else {
            currentConfig[key] = value
          }
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

    if (currentBrand["replacements"]) {
      if (!currentConfig["replacements"]) {
        currentConfig["replacements"] = {}
      }

      Object.entries(currentBrand["replacements"]).forEach(([key, value]) => {
        currentConfig["replacements"][key] = value
      })
    }

    if (currentBrand["replacements_files"]) {
      if (!currentConfig["replacements_files"]) {
        currentConfig["replacements_files"] = []
      }
      currentConfig["replacements_files"] = currentConfig["replacements_files"].concat(currentBrand["replacements_files"])
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

  private async finalizeBuild(finalConfig: Dictionary<any>) {
    let replacements = finalConfig["replacements"];

    if (finalConfig["replacements_files"]) {
      finalConfig["replacements_files"].forEach((replacementFile: string) => {
        const filepath = path.join(this.taskScope.uri.fsPath, replacementFile);
        if (fs.existsSync(filepath)) {
          let replacementAdd = JSON5.parse(fs.readFileSync(filepath).toString());

          Object.entries(replacementAdd).forEach(([key, value]) => {
            replacements[key] = value
          })
        }
      })
    }

    if (fs.existsSync(this.targetDir)) {
      fs.rmSync(this.targetDir, {recursive: true})
    }
    fs.mkdirSync(this.targetDir);

    for (const sourceFile of finalConfig["!files"]) {
      const fileInfo = path.parse(sourceFile.absoluteFilePath);
      const isTextFile = fileInfo.ext.match(/\.(brs|json|xml|txt)/i)
      const isBannedFile = fileInfo.ext.match(/\.(zip)/i)

      if (isTextFile) {
        let content = fs.readFileSync(sourceFile.absoluteFilePath, {encoding: "utf-8"});
        const targetFilePath = path.join(this.targetDir, sourceFile.relativeFilePath);
        const targetFileInfo = path.parse(targetFilePath)

        content = this.replaceBulk(content, Object.keys(replacements), Object.values(replacements))

        fs.mkdirSync(targetFileInfo.dir, {recursive: true});
        fs.writeFileSync(targetFilePath, content, {flag: "w"});
      } else if (!isBannedFile) {
        const targetFilePath = path.join(this.targetDir, sourceFile.relativeFilePath);
        const targetFileInfo = path.parse(targetFilePath)
        const isAnimation = sourceFile.relativeFilePath.match(/^assets\/animations\/([a-z0-9\- ]+)/i)

        if (isAnimation) {
          if (!finalConfig["!animations"]) {
            finalConfig["!animations"] = {}
          }
          if (!finalConfig["!animations"][isAnimation[1]]) {
            finalConfig["!animations"][isAnimation[1]] = {
              "subtype": "Node"
            }
          }
          finalConfig["!animations"][isAnimation[1]][targetFileInfo.name.replaceAll(" ", "-")] = await this.processSprite(sourceFile, targetFileInfo)
        } else {
          fs.mkdirSync(targetFileInfo.dir, {recursive: true});
          fs.copyFileSync(sourceFile.absoluteFilePath, targetFilePath)
        }
      }
    }

    if (finalConfig["!animations"]) {
      const targetDir = path.join(this.targetDir, "assets", "animations")
      fs.mkdirSync(targetDir, {recursive: true});
      Object.entries(finalConfig["!animations"]).forEach(([key, value]) => {
        const animFile = path.join(targetDir, key + ".json")
        fs.writeFileSync(animFile, JSON.stringify(value))
      })
    }

    let manifest: string = ""

    Object.entries(finalConfig["manifest"]).forEach(([key, value]) => {
      let typeValue: any = value;

      if (typeof typeValue === "object") {
        let valueConcat: string[] = [];

        Object.entries(typeValue).forEach(([key, value]) => {
          valueConcat.push(key + "=" + value)
        })
        manifest += key + "=" + valueConcat.join(";") + "\n";
      } else {
        manifest += key + "=" + typeValue.toString() + "\n"
      }
    })
    manifest += "\n"
    fs.writeFileSync(path.join(this.targetDir, "manifest"), manifest)

    if (this.configData["resolutions"]) {
      this.configData["resolutions"].forEach((resolution: string) => {
        Object.entries(finalConfig["!config"]).forEach(([region, regionValue]) => {
          const createdConfig = this.createConfig(<Dictionary<any>>regionValue, resolution)
          const filePath = path.join(this.targetDir, "region", region)

          fs.mkdirSync(filePath, {recursive: true});
          Object.entries(createdConfig).forEach(([environment, environmentValue]) => {
            fs.writeFileSync(path.join(filePath, environment + "_" + resolution + ".json"), JSON.stringify(environmentValue));
          })
        })
      })
    } else {
      Object.entries(finalConfig["!config"]).forEach(([region, regionValue]) => {
        const createdConfig = this.createConfig(<Dictionary<any>>regionValue, "fhd")
        const filePath = path.join(this.targetDir, "region", region)

        fs.mkdirSync(filePath, {recursive: true});

        Object.entries(createdConfig).forEach(([environment, environmentValue]) => {
          fs.writeFileSync(path.join(filePath, environment + "_fhd.json"), JSON.stringify(environmentValue));
        })
      })
    }
  }

  private async processSprite(sourceFile: rokuBuilderFileInfo, targetFileInfo: path.ParsedPath): Promise<Dictionary<any> | undefined> {
    if (targetFileInfo.ext == ".gif") {
      const image = await new GIF.GifReader(fs.readFileSync(sourceFile.absoluteFilePath))
      let imageInfo = {
          "subtype": "Node",
          "numberOfFrames": image.numFrames(),
          "frames": [] as Array<any>
      }

      for (let frameNum=0;frameNum<image.numFrames();frameNum++) {
        const imageData = Buffer.alloc(image.width * image.height * 4)
        image.decodeAndBlitFrameRGBA(frameNum, imageData)
        const newImageData = await sharp(imageData, {raw: {width: image.width, height: image.height, channels: 4}}).png().toBuffer()

        imageInfo.frames.push({
          "uri": newImageData.toString("base64")
        })
      }

      return Promise.resolve(imageInfo)
    } else {
      return Promise.resolve(undefined)
    }
  }

  private parseConfig(brand: string) {
    let config: Dictionary<any> = {}
    let matches = glob.sync(path.join(this.taskScope.uri.fsPath, "brands", brand, "region/*"))
    matches.forEach((regionPath) => {
      const region = path.relative(path.join(this.taskScope.uri.fsPath, "brands", brand, "region"), regionPath)
      config[region] = {}

      const configPath = path.join(regionPath, "config.json")

      if (fs.existsSync(configPath)) {
        const regionConfigData = JSON5.parse(fs.readFileSync(configPath).toString());

        config[region] = regionConfigData;

        const configSections = this.configData["channel_config_sections"];
        const configMatches = glob.sync(path.join(regionPath, "configs/{" + configSections.join(",") + "}/**/*"), {nodir: true})
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

          const componentConfig = JSON5.parse(fs.readFileSync(regionConfigPath).toString());

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

    createdConfig["production"] = this.createConfigSection(config, resolution, "production")
    createdConfig["staging"] = this.createConfigSection(config, resolution, "staging")

    return createdConfig
  }

  private createConfigSection(section: any, resolution: string, environment: string): any {
    let createdSection: any;

    if (Array.isArray(section)) {
      createdSection = []
      section.forEach((value: any, index: number) => {
        createdSection[index] = this.createConfigSection(value, resolution, environment);
      })
    } else if (typeof section === "object") {
      if (section[resolution] != undefined) {
        createdSection = this.createConfigSection(section[resolution], resolution, environment);
      } else if (section[environment] != undefined) {
        createdSection = this.createConfigSection(section[environment], resolution, environment);
      } else {
        createdSection = {}
        Object.entries(section).forEach(([componentKey, componentValue]) => {
          createdSection[componentKey] = this.createConfigSection(componentValue, resolution, environment);
        })
      }
    } else {
      createdSection = section
    }

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

  private replaceBulk( str: string, findArray: string[], replaceArray: string[] ){
    var i, regex: string[] = [], map: Dictionary<any> = {}; 
    for( i=0; i<findArray.length; i++ ){ 
      regex.push( findArray[i].replace(/([-[\]{}()*+?.\\^$|#,])/g,'\\$1') );
      map[findArray[i]] = replaceArray[i]; 
    }
    let regexStr = regex.join('|');
    str = str.replace( new RegExp( regexStr, 'g' ), function(matched){
      return map[matched];
    });
    return str;
  }
}