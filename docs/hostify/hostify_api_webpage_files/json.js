var formatter = (function () {

    function repeat(s, count) {
        return new Array(count + 1).join(s);
    }

    function toNode(text, cls) {
    	return cls ? `<span class="${cls}">${text}</span>` : text;
    }

    function formatJson(json, indentChars) {
    	// json = JSON.stringify(json);

        var i           = 0,
            il          = 0,
            tab         = (typeof indentChars !== "undefined") ? indentChars : "&emsp;",
            newJson     = "",
            indentLevel = 0,
            inString    = false,
            inValue    = false,
            currentChar = null;

        for (i = 0, il = json.length; i < il; i += 1) { 
            currentChar = json.charAt(i);

            var cls = false;

            switch (currentChar) {
            case '{':
            case '[': 
            	cls = "bracket";
                if (!inString) { 
                    newJson += toNode(currentChar, cls) + "\n" + repeat(tab, indentLevel + 1);
                    indentLevel += 1; 
                } else { 
                    newJson += toNode(currentChar, cls); 
                }
                break; 
            case '}':
            case ']': 
            	cls = "bracket";
                if (!inString) { 
                    indentLevel -= 1; 
                    newJson += "\n" + repeat(tab, indentLevel) + toNode(currentChar, cls); 
                } else { 
                    newJson += toNode(currentChar, cls); 
                } 
                break; 
            case ',': 
            	cls = "comma"
                if (!inString) { 
                    newJson += ",\n" + repeat(tab, indentLevel); 
                } else { 
                    newJson += toNode(currentChar, cls); 
                } 
                break; 
            case ':':
            	cls = "colon"
                if (!inString) { 
                    newJson += toNode(": ", cls); 
                } else { 
                    newJson += toNode(currentChar, cls); 
                } 
                break; 
            case ' ':
            case "\n":
            	inValue = false;
            case "\t":
                if (inString) {
                    newJson += toNode(currentChar, cls);
                }
                break;
            case '"':
            	cls = "quote"
                if (i > 0 && json.charAt(i - 1) !== '\\') {
                    inString = !inString; 
                }
                if (i > 0 && json.charAt(i - 2) === ':') {
                    inValue = !inValue; 
                }
                if (i > 0 && json.charAt(i+1) === ",") {
                	inValue = false;
                }
                if (inString) {
                	cls = inValue ? "val" : "prop";
                	newJson += `<span class="${cls}">${currentChar}`;
                } else {
                	newJson += `${currentChar}</span>`;
                }
                // newJson += toNode(currentChar, cls); 
                break;
            default: 
                newJson += toNode(currentChar, cls); 
                break;                    
            } 
        } 

        return newJson; 
    }

    return { "formatJson": formatJson };

}());