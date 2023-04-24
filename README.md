# Roku Builder README

This extension allows building of projects created using a branding system of apps.
Each config can be made to create multiple channels using on codebase.

## Example config file

This file should be name `.roku_builder_rebrand.json` and reside in your workspace root.
Values containing `{}` will be replaced with variables from the config. For example, in the `!repeat_brands` loop `{brand}` will be replaced by the `replace`.`brand` value

```json
{
  "targets": [
    "folder",
    "file.ext"
  ],
  "channel_config_sections": [
    "folderForConfigFile"
  ],
  "resolutions": [
    "fhd",
    "hd"
  ],
  "brands": {
    "core": {
      "replacements": {
        "##COPYRIGHT HEADER##": "*****  *****"
      },
      "manifest": {
        "rsg_version": 1.2,
        "title": "Core",
        "major_version": 1,
        "minor_version": 0,
        "build_version": "0001",
        "mm_icon_focus_fhd": "pkg:/assets/fhd/roku-icon.png",
        "mm_icon_focus_hd": "pkg:/assets/hd/roku-icon.png",
        "mm_icon_focus_sd": "pkg:/assets/sd/roku-icon.png",
        "splash_screen_fhd": "pkg:/assets/fhd/roku-splash.jpg",
        "splash_screen_hd": "pkg:/assets/hd/roku-splash.jpg",
        "splash_screen_sd": "pkg:/assets/hd/roku-splash.jpg",
        "splash_rsg_optimization": "1",
        "splash_min_time": 3000,
        "ui_resolutions": "fhd, hd",
        "uri_resolution_autosub": "%RES%, sd, hd, fhd",
        "config": "https://remoteconfig/configs/{locale}/{res}.json",
        "bs_const": {
          "DEBUG": false,
          "DEBUG_HTTPS": false
        },
        "supports_input_launch": 1,
        "environment": "production",
        "bs_libs_required": "roku_ads_lib,googleima3",
        "sg_component_libs_required": "roku_analytics"
      },
      "targets": [
        "folder",
        "file.ext"
      ]
    },
    "!repeat_brands": {
      "for": ["brand"],
      "replace": {
        "title": ["Brand App"],
        "brand": ["brand"]
      },
      "brands": {
        "{key}": {
          "parents": ["core"],
          "manifest": {
            "title": "{title}",
            "brand": "{brand}"
          },
          "replacements_files": [
            "fileToReplaceValues.json"
          ]
        },
        "{key}-staging": {
          "parents": ["{key}"],
          "signing_key": "{key}-staging",
          "targets": [
            "folder",
            "file.ext"
          ],
          "manifest": {
            "title": "{title}-Staging",
            "brand": "{brand}",
            "environment": "staging",
            "config": "https://remoteconfig/configs/{locale}/{res}.json",
            "bs_const": {
              "DEBUG": false,
              "DEBUG_HTTPS": false
            }
          },
          "replacements_files": [
            "fileToReplaceValues.json"
          ]
        }
      }
    }
  }
}
```

## Example Task options

This should be setup in your `.vscode/task.json` file
```json
{
  // See https://go.microsoft.com/fwlink/?LinkId=733558
  // for the documentation about the tasks.json format
  "version": "2.0.0",
  "tasks": [
    {
      "label": "BuildWithRokuBuilder",
      "type": "rokubuilder",
      "brand": "${input:brand}",
      "targetDir": "${workspaceFolder}/dist",
      "problemMatcher": []
    },
  ],
  "inputs": [
    {
      "id": "brand",
      "type": "pickString",
      "description": "Select the brand to use",
      "options": [
        "brand",
        "brand-staging"
      ]
    }
  ]
}
```