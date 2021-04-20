# Auto Initiative
Roll initiative for all NPCs with just one click! Simply open the turn order and initiatives for all NPC tokens on the player page are automatically rolled and added to the turn order.

You can group monsters of the same type or have each monster's initiative rolled separately.
You can also specify a maximum number of monsters per group. Monsters of the same type will be divided into subgroups and assigned color-coordinated status markers.
For example, if you have 12 goblins and set the group max to 4, the script will create three groups of 4 goblins, roll initiative for each group, and assign each token a color marker so you can easily identify which goblin belongs to which group.

Settings can be configured with commands, but also with an easy to use menu that allows you to set options with just one click.

## Commands
* `!autoinit` - sends the settings menu to the Roll20 chat. Contains clickable options.
* `!autoinit --recover` - accidentally close the turnorder? Do not panic. Simply re-open the turn order and use this command to restore the previous turn order.
* `!autoinit --clear` - removes the color markers assigned to subgroups.
* `!autoinit --enable [true|false]` - enables or disables Auto Initiative.
* `autoinit --help` - displays command usage

## Options
* `!autoinit --group [true|false]` - whether to group monsters of the same type or roll individually.
* `!autoinit --output [true|false]` - whether to send initiative rolls to the Roll20 chat.
* `!autoinit --players [true|false]` - whether to roll initiative for player characters in addition to NPCs.
* `!autoinit --max [number|none]` - maximum number of tokens allowed per group. If group limit is exceeded tokens are placed into color-coordinated subgroups.
