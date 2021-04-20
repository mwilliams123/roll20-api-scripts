/*
 * Version 1.0
 * By: Megan W.
 * Roll20: https://app.roll20.net/users/3004169/megan-w
 * Github: https://github.com/mwilliams123
*/

const AutoInitiative = (() => {

    const stateName = 'AUTO_INITIATIVE';
    const scriptName = 'AutoInitiative';
    const commandName = '!autoinit';
    const tokenMarkers = ['blue', 'brown', 'green', 'red', 'yellow', 'purple', 'pink'];
    let prevTurnOrder;
    
    /**
     * Listens for chat messages to toggle settings and add initiative rolls to turnorder.
     * 
     * @param {Object} msg - A message sent to the Roll20 chat.
     * 
     * @listens event:chat:message
     */
    const handleInput = function(msg) {
        // get auto initiative rolls from chat and add to turn order
        if (msg.who === scriptName && msg.rolltemplate === 'npc') {
            addToTurnOrder(msg);
            return;
        } else if (msg.type !== 'api') {
            return;
        }

        // check for !autoinit command issued by GM only
        if (!msg.content.includes(commandName) || !playerIsGM(msg.playerid)) {
            return;
        }
        
        // get api command and its args
        const args = msg.content.split(/\s+--/);
        const command = args.shift();
        if (command !== commandName) {
            genHelpMessage();
            return;
        }
        if (args.length == 0) {
            genConfigMenu();
        }
        args.forEach(arg => {
            const params = arg.split(/\s/);
            switch(params[0]){
                case 'group':
                    toggleOption(params, "Group Monsters");
                    break;
                case 'output':
                    toggleOption(params, "Send to Chat");
                    break;
                case 'enable':
                    toggleOption(params, "AutoInitiative");
                    break;
                case 'players':
                    toggleOption(params, "Roll for players");
                    break;
                case 'max':
                    setMaxPerGroup(params);
                    break;
                case 'clear':
                    clearMarkers();
                    return;
                case 'recover':
                    Campaign().set("turnorder", prevTurnOrder);
                    return;
                default:
                    genHelpMessage();
                    return;
            }
        });
    };

    /**
     * Parses initiative rolls and adds tokens to turnorder.
     * 
     * @param {Object} msg - An initiative roll sent to the Roll20 chat by autoinit.
     */
    const addToTurnOrder = function(msg) {
        // use regexp to extract token id and page from message
        const tokenId_regexp = /{{tokenId=(.*?)}}/;  
        const tokenId = tokenId_regexp.exec(msg.content)[1];
        const page_regexp = /{{page=(.*?)}}/;  
        const page = page_regexp.exec(msg.content)[1];
        
        // add to token to turn order
        const turnOrder = JSON.parse(Campaign().get("turnorder"));
        if (!turnOrder) return;                                     
        turnOrder.push({
            "id": tokenId,
            "pr": msg.inlinerolls[1].results.total,
            "custom": "",
            "_pageid": page
        });
        setTurnOrder(turnOrder);
    };
    
    /**
     * Sorts (descending) and updates the turnorder.
     * 
     * @param {Array.<Object>} turnOrder - An array of turn objects.
     */
    const setTurnOrder = function (turnOrder) {
        turnOrder.sort((a,b) => {
            return (b.pr - a.pr);
        })
        Campaign().set("turnorder", JSON.stringify(turnOrder));
    };
    
    /**
     * Validates and sets an option to true or false.
     * 
     * @param {Array.<String>} option - First element is name of option. Second is 'true' or 'false'.
     * @param {String} desc - Description of option.
     */
    const toggleOption = function(option, desc) {
        // validate input
        if (option.length !== 2 || (option[1] !== 'true' && option[1] !== 'false')) {
            genHelpMessage(option[0] + " must be 'true' or 'false'");
            return;
        } 
        // store variable in state
        state[stateName][option[0]] = option[1] === 'true';
        // Send confirmation to chat
        sendChat('AutoInitiative', '/w gm ' + desc + (state[stateName][option[0]] ? " Enabled" : " Disabled"), null, {noarchive:true});
    }
    
    /**
     * Validates and sets max_per_group.
     * 
     * @param {Array.<String>} option - First element is name of option. Second is a number.
     */
    const setMaxPerGroup = function(option) {
        // validate input
        if (option.length !== 2) {
            genHelpMessage();
            return;
        } 
        if (option[1] === 'none') {
            state[stateName].max_per_group = null;
            sendChat('AutoInitiative', '/w gm Disabled Max Per Group limit ', null, {noarchive:true});
            return;
        }
        const num = Number(option[1]);
        if (!num || num < 2) {
            genHelpMessage("max must be a valid number greater than 1 or 'none'.");
            return;
        }
        // store variable in state
        state[stateName].max_per_group = num;
        // Send confirmation to chat
        sendChat('AutoInitiative', '/w gm Set Max Per Group to ' + num, null, {noarchive:true});
    }

    /**
     * Rolls initiative for all NPCs and adds them to the turn order.
     * 
     * @param {Object} obj - Campaign object representing game state
     * @param {Object} prev - Previous obj when event was last triggered.
     * 
     * @listens event:change:campaign:initiativepage
     */
    const handleInitiativeOpen = function(obj, prev){
        if (!state[stateName].enable) {
            return;
        }
        
        if (!Campaign().get("initiativepage")) { // turn order is being closed
            prevTurnOrder = prev.turnorder; // store the last turnorder object
            return;
        }
        
        // clear turn order
        let turnOrder = [];
        Campaign().set("turnorder", "[]");
        
        // get all tokens on page that represent a character. Filter out PCs unless 'players' option is true.
        const currPage = Campaign().get("playerpageid");
        let tokens = findObjs({_pageid: currPage, _type: "graphic"});
        tokens = tokens.filter((token) => {
            const character = getObj('character', token.get('represents')); 
            return (character && (state[stateName].players || !isPlayer(character.get('controlledby'))));
        });
        
        // group tokens and roll initiative for one member of each group
        const groups = getGroups(tokens);
        for (const key in groups) {
            rollInitiative(groups[key][0], turnOrder);
        }
        
        // add rolls that aren't output to chat to turnorder
        if (!state[stateName].output) {
            setTurnOrder(turnOrder);
        }
    };
    
    /**
     * Sorts tokens into initiative groups. 
     * 
     * Groups tokens by name and type if 'group' option is specified. Otherwise each token gets its own group.
     * Each group contains no more than 'max_per_group' tokens, splitting tokens into subgroups if necessary.
     * 
     * @param {Array.<Object>} tokens - A list of tokens to roll initiative for.  
     * 
     * @return {Object.<string, Array>} A map with each key representing a monster group
     *                                  and each value an array of tokens in the group.
     */
    const getGroups = function(tokens) {
        let tokensByType = {};
        // group tokens by type based on both the character represented and token name.
        // NOTE: tokens representing the same character with different names will NOT be grouped together.
        for (const token of tokens) {
            const uniqueId = token.get("name") + token.get('represents');
            if (!state[stateName].group) { // each token gets own group
                tokensByType[token.id] = [token];
            }
            else if (tokensByType[uniqueId]) {
                tokensByType[uniqueId].push(token);
            } else {
                tokensByType[uniqueId] = [token];
            }
        }
        if (!state[stateName].max_per_group || !state[stateName].group) {
            return tokensByType;
        }
        // break down into smaller groups and assign markers, if necessary
        let groups = {}
        assignedMarkers = 0;
        for (const key in tokensByType) {
            const tokenGroup = tokensByType[key];
            // check # tokens in group does not exceed limit
            if (tokenGroup.length <= state[stateName].max_per_group) {
                groups[key] = tokenGroup;
            } else {
                // calculate # subgroups needed for token group
                const numSplits = Math.ceil(tokenGroup.length / state[stateName].max_per_group);
                // evenly distribute tokens into subgroups
                for (let i = 0; i < tokenGroup.length; i++) {
                    let groupNum = i%numSplits;
                    if (!groups[key+groupNum]) {
                        groups[key+groupNum] = [tokenGroup[i]];
                    } else {
                        groups[key+groupNum].push(tokenGroup[i]);
                    }
                    assignMarker(tokenGroup[i], groupNum);
                }
            }
        }
        return groups;
    }
    
     /**
     * Assigns a marker to a token based on its subgroup.
     * 
     * If the number of subgroups exceeds the number of markers, multiple markers may be assigned.
     * 
     * @param {Object} token - A Roll20 token object.  
     * @param {number} n - The index of the token's subgroup.  
     */
    const assignMarker = function(token, n) {
        // assign token belonging to the nth subgroup the nth marker 
        if (n < tokenMarkers.length ) {
            token.set('status_'+ tokenMarkers[n], true);
            return;
        } 
        // Recursively assign more markers as needed to represent the subgroup index as
        // the sum in base N of the values of markers assigned, where N is # markers.
        let counts = Array(tokenMarkers.length).fill(0); // keeps track of markers assigned
        while (n > 0) {
            const remainder = n % tokenMarkers.length;
            counts[remainder] += 1;
            token.set('status_'+ tokenMarkers[remainder], true);
            n = Math.floor(n/tokenMarkers.length);
        }
        
        // account for duplicate marker assignments by adding a different marker
        const indx = counts.find(c => c > 1);
        if (indx) {
            token.set('status_'+ tokenMarkers[(indx+1)%tokenMarkers.length], true);
            // assign one more marker to avoid collisions
            token.set('status_'+ tokenMarkers[(indx+2)%tokenMarkers.length], true);
        }
    }
    
    /**
     * Clears color markers from all tokens
     */
    const clearMarkers = function() {
        const currPage = Campaign().get("playerpageid");
        const tokens = findObjs({_pageid: currPage, _type: "graphic"});
        for (const token of tokens) {
             for (const marker of tokenMarkers) {
                token.set('status_'+ marker, false);
            }
        }
    }
    
    /**
     * Sends an initiative roll to chat or manually rolls if chat output is disabled.
     * 
     * @param {Object} token - A Roll20 token object.
     * @param {Array.<Object>} turnOrder - An array of turn objects.
     *
     */
    const rollInitiative = function(token, turnOrder) {
        const character = getObj('character', token.get('represents')); 
        if (state[stateName].output) {
            // send initiative rolls to chat with additional page and tokenId parameters to be used in addToTurnOrder.
            const name = character.get("name");
            const message = `&{template:npc} {{name=${name}}} {{page=${token.pageid}}} {{tokenId=${token.id}}} {{rname=^{init}}} {{r1=[[1d20+[[@{${name}|initiative_bonus}]][DEX] ]]}} {{normal=1}} {{type=Initiative}}`;
            sendChat('AutoInitiative' ,`@{${name}|wtype}` + message);
        } else {
            // get character's initiative bonus and manually roll initiative
            const initAttr = findObjs({ type: 'attribute', characterid: character.id, name: "initiative_bonus"})[0];
            const bonus = Number(initAttr.get('current'));
            const initRoll = randomInteger(20) + bonus;

            // add to turn order
            turnOrder.push({
                "id": token.id,
                "pr": initRoll,
                "custom": "",
                "_pageid": token.pageid
            });
        }
    };
    
    /**
     * Determines if a character sheet is controlled by any players.
     *
     * @param {String} controlledBy - A ',' delimited string of user Ids controlling a character.
     * 
     * @return {boolean} Returns true if at least one non-GM player controls the character.
     */
    const isPlayer = function(controlledBy){
        if (controlledBy === "") {
            return false;
        }
        return !controlledBy.split(/,/).every(playerIsGM);
    };
    
    /**
     * Outputs usage to the Roll20 chat.
     * 
     * @param {String} [msg] - An optional message detailing an error.
     */
    const genHelpMessage = function(msg = ""){
        
        const usage = "<div><p>Proper usage: !autoinit --option arg </p> \
                        <h3>Commands:</h3> \
                        <p><b>!autoinit</b> - Get settings menu.</p>\
                        <p><b>!autoinit --recover</b> - Restore last closed turnorder.</p>\
                        <p><b>!autoinit --clear</b> - Remove color token markers.</p>\
                        <h3> Options: </h3>\
                        <p><b>--enable</b> [<b>true|false</b>]  -  Enable or disable script. </p>\
                        <p><b>--group</b> [<b>true|false</b>]    -   Whether to group monsters or roll individually. </p>\
                        <p><b>--output</b> [<b>true|false</b>]    -   Whether to send rolls to chat. </p>\
                        <p><b>--players</b> [<b>true|false</b>]   -   Whether to roll for player characters. </p>\
                        <p><b>--max</b> [<b>number|none</b>]      -   Maximum number of tokens in one group. If group limit is exceeded tokens are placed into color-coordinated subgroups.</p></div>";
        sendChat(scriptName, '/w gm ' + msg + usage);
    };
    
    /**
     * Outputs settings config to the Roll20 chat with toggleable options
     */
    const genConfigMenu = function() {
        let config = '<h3>Actions</h3>'
        config += makeAction('Recover Last Turnorder', "--recover", "Recover");
        config += makeAction('Clear color markers', "--clear", "Clear");
        config += makeAction('Disable/Enable AutoInitiative', `--enable ${state[stateName].enable ? 'false' : 'true'}`, state[stateName].enable ? 'Disable' : 'Enable');
        config += '<h3>Options</h3>';
        config += makeOption('Group Monsters', state[stateName].group, 'group');
        config += makeOption('Send to Chat', state[stateName].output, 'output');
        config += makeOption('Roll for Players', state[stateName].players, 'players'); 
        config += `<div style="height: 30px;"><span style="line-height: 30px;">Max tokens per group</span><a style="float: right;" href="${commandName} --max ?{Enter number or 'none' to disable|none}">${state[stateName].max_per_group ? state[stateName].max_per_group  : 'none' }</a></div>`;
        sendChat('AutoInitiative', '/w gm ' + config);
    };
    
    /**
     * Creates a button which can toggle a setting option.
     *                      
     * @param {String} name - Descriptive name of the option.
     * @param {boolean} value - Whether the option is currently enabled.
     * @param {String} command - Name of the API arg to toggle the setting.
     * 
     * @return {String} The HTML for the button.
     */
    const makeOption = function(name, value, command) {
        const label = `<div style="height: 30px;"><span style="line-height: 30px;">${name}</span>`;
        return label + `<a style="float: right;" href="${commandName} --${command} ${value ? 'false': 'true'}">${value ? 'Disable ' : 'Enable '}</a></div>`;
    }
    
    /**
     * Creates a button which can trigger an action.
     *                      
     * @param {String} name - Descriptive name of the action.
     * @param {String} command - Name of the API arg to trigger the action.
     * @param {String} label - Label for the button.
     * 
     * @return {String} The HTML for the button.
     */
    const makeAction = function(name, command, label) {
        return `<div style="height: 30px;"><span style="line-height: 30px;">${name}</span>` + 
            `<a style="float: right;" href="${commandName} ${command}">${label}</a></div>`;
    };

    /**
     * Register events to detect when turn order is opened or closed and when
     * chat is messaged.
     */
    const registerEventHandlers = function() {
        on('chat:message', handleInput);
        on('change:campaign:initiativepage', handleInitiativeOpen);
    };
    
    on('ready',function() {
        if (!state[stateName]) {
            state[stateName] = {
                'group': false,
                'output': false,
                'players': false,
                'enable': false,
                'max_per_group': null,
            }
        }
        registerEventHandlers();
    });

    return {
        RegisterEventHandlers: registerEventHandlers
    };
})();
