//  Copyright (c) 2014 Readium Foundation and/or its licensees. All rights reserved.
//  
//  Redistribution and use in source and binary forms, with or without modification, 
//  are permitted provided that the following conditions are met:
//  1. Redistributions of source code must retain the above copyright notice, this 
//  list of conditions and the following disclaimer.
//  2. Redistributions in binary form must reproduce the above copyright notice, 
//  this list of conditions and the following disclaimer in the documentation and/or 
//  other materials provided with the distribution.
//  3. Neither the name of the organization nor the names of its contributors may be 
//  used to endorse or promote products derived from this software without specific 
//  prior written permission.

(function(global) {

var init = function($, _, cfiRuntimeErrors) {
    
var obj = {

// Description: This model contains the implementation for "instructions" included in the EPUB CFI domain specific language (DSL). 
//   Lexing and parsing a CFI produces a set of executable instructions for processing a CFI (represented in the AST). 
//   This object contains a set of functions that implement each of the executable instructions in the AST. 

    // ------------------------------------------------------------------------------------ //
    //  "PUBLIC" METHODS (THE API)                                                          //
    // ------------------------------------------------------------------------------------ //

    // Description: Follows a step
    // Rationale: The use of children() is important here, as this jQuery method returns a tree of xml nodes, EXCLUDING
    //   CDATA and text nodes. When we index into the set of child elements, we are assuming that text nodes have been 
    //   excluded.
    // REFACTORING CANDIDATE: This should be called "followIndexStep"
    getNextNode : function (CFIStepValue, $currNode, classBlacklist, elementBlacklist, idBlacklist) {

        // Find the jquery index for the current node
        var $targetNode;
        if (CFIStepValue % 2 == 0) {

            $targetNode = this.elementNodeStep(CFIStepValue, $currNode, classBlacklist, elementBlacklist, idBlacklist);
        }
        else {

            $targetNode = this.inferTargetTextNode(CFIStepValue, $currNode, classBlacklist, elementBlacklist, idBlacklist);
        }

        return $targetNode;
    },

    // Description: This instruction executes an indirection step, where a resource is retrieved using a 
    //   link contained on a attribute of the target element. The attribute that contains the link differs
    //   depending on the target. 
    // Note: Iframe indirection will (should) fail if the iframe is not from the same domain as its containing script due to 
    //   the cross origin security policy
    followIndirectionStep : function (CFIStepValue, $currNode, classBlacklist, elementBlacklist, idBlacklist) {

        var that = this;
        var $contentDocument; 
        var $blacklistExcluded;
        var $startElement;
        var $targetNode;

        // TODO: This check must be expanded to all the different types of indirection step
        // Only expects iframes, at the moment
        if ($currNode === undefined || !this._matchesLocalNameOrElement($currNode[0], 'iframe')) {

            throw cfiRuntimeErrors.NodeTypeError($currNode, "expected an iframe element");
        }

        // Check node type; only iframe indirection is handled, at the moment
        if (this._matchesLocalNameOrElement($currNode[0], 'iframe')) {

            // Get content
            $contentDocument = $currNode.contents();

            // Go to the first XHTML element, which will be the first child of the top-level document object
            $blacklistExcluded = this.applyBlacklist($contentDocument.children(), classBlacklist, elementBlacklist, idBlacklist);
            $startElement = $($blacklistExcluded[0]);

            // Follow an index step
            $targetNode = this.getNextNode(CFIStepValue, $startElement, classBlacklist, elementBlacklist, idBlacklist);

            // Return that shit!
            return $targetNode; 
        }

        // TODO: Other types of indirection
        // TODO: $targetNode.is("embed")) : src
        // TODO: ($targetNode.is("object")) : data
        // TODO: ($targetNode.is("image") || $targetNode.is("xlink:href")) : xlink:href
    },

    // Description: Injects an element at the specified text node
    // Arguments: a cfi text termination string, a jquery object to the current node
    // REFACTORING CANDIDATE: Rename this to indicate that it injects into a text terminus
    textTermination : function ($currNode, textOffset, elementToInject) {

        var $injectedElement;
        // Get the first node, this should be a text node
        if ($currNode === undefined) {

            throw cfiRuntimeErrors.NodeTypeError($currNode, "expected a terminating node, or node list");
        } 
        else if ($currNode.length === 0) {

            throw cfiRuntimeErrors.TerminusError("Text", "Text offset:" + textOffset, "no nodes found for termination condition");
        }

        $injectedElement = this.injectCFIMarkerIntoText($currNode, textOffset, elementToInject);
        return $injectedElement;
    },

    // Description: Checks that the id assertion for the node target matches that on 
    //   the found node. 
    targetIdMatchesIdAssertion : function ($foundNode, idAssertion) {

        if ($foundNode.attr("id") === idAssertion) {

            return true;
        }
        else {

            return false;
        }
    },

    // ------------------------------------------------------------------------------------ //
    //  "PRIVATE" HELPERS                                                                   //
    // ------------------------------------------------------------------------------------ //

    // Description: Step reference for xml element node. Expected that CFIStepValue is an even integer
    elementNodeStep : function (CFIStepValue, $currNode, classBlacklist, elementBlacklist, idBlacklist) {

        var $targetNode;
        var $blacklistExcluded;
        var numElements;
        var jqueryTargetNodeIndex = (CFIStepValue / 2) - 1;

        $blacklistExcluded = this.applyBlacklist($currNode.children(), classBlacklist, elementBlacklist, idBlacklist);
        numElements = $blacklistExcluded.length;

        if (this.indexOutOfRange(jqueryTargetNodeIndex, numElements)) {

            throw cfiRuntimeErrors.OutOfRangeError(jqueryTargetNodeIndex, numElements - 1, "");
        }

        $targetNode = $($blacklistExcluded[jqueryTargetNodeIndex]);
        return $targetNode;
    },

    retrieveItemRefHref : function ($itemRefElement, packageDocument) {

        return $("#" + $itemRefElement.attr("idref"), packageDocument).attr("href");
    },

    indexOutOfRange : function (targetIndex, numChildElements) {

        return (targetIndex > numChildElements - 1) ? true : false;
    },

    // Rationale: In order to inject an element into a specific position, access to the parent object 
    //   is required. This is obtained with the jquery parent() method. An alternative would be to 
    //   pass in the parent with a filtered list containing only children that are part of the target text node.
    injectCFIMarkerIntoText : function ($textNodeList, textOffset, elementToInject) {
        var document = $textNodeList[0].ownerDocument;

        var nodeNum;
        var currNodeLength;
        var currTextPosition = 0;
        var nodeOffset;
        var originalText;
        var $injectedNode;
        var $newTextNode;
        // The iteration counter may be incorrect here (should be $textNodeList.length - 1 ??)
        for (nodeNum = 0; nodeNum <= $textNodeList.length; nodeNum++) {

            if ($textNodeList[nodeNum].nodeType === Node.TEXT_NODE) {

                currNodeMaxIndex = $textNodeList[nodeNum].nodeValue.length  + currTextPosition;
                nodeOffset = textOffset - currTextPosition;

                if (currNodeMaxIndex > textOffset) {

                    // This node is going to be split and the components re-inserted
                    originalText = $textNodeList[nodeNum].nodeValue;    

                    // Before part
                    $textNodeList[nodeNum].nodeValue = originalText.slice(0, nodeOffset);

                    // Injected element
                    $injectedNode = $(elementToInject).insertAfter($textNodeList.eq(nodeNum));

                    // After part
                    $newTextNode = $(document.createTextNode(originalText.slice(nodeOffset, originalText.length)));
                    $($newTextNode).insertAfter($injectedNode);

                    return $injectedNode;
                } else if (currNodeMaxIndex == textOffset){
                    $injectedNode = $(elementToInject).insertAfter($textNodeList.eq(nodeNum));
                    return $injectedNode;
                }
                else {
                    currTextPosition = currNodeMaxIndex;
                }
            } else if($textNodeList[nodeNum].nodeType === Node.COMMENT_NODE){
                currNodeMaxIndex = $textNodeList[nodeNum].nodeValue.length + 7 + currTextPosition;
                currTextPosition = currNodeMaxIndex;
            } else if($textNodeList[nodeNum].nodeType === Node.PROCESSING_INSTRUCTION_NODE){
                currNodeMaxIndex = $textNodeList[nodeNum].nodeValue.length + $textNodeList[nodeNum].target.length + 5
                currTextPosition = currNodeMaxIndex;
            }
        }

        throw cfiRuntimeErrors.TerminusError("Text", "Text offset:" + textOffset, "The offset exceeded the length of the text");
    },

    // Rationale: In order to inject an element into a specific position, access to the parent object 
    //   is required. This is obtained with the jquery parent() method. An alternative would be to 
    //   pass in the parent with a filtered list containing only children that are part of the target text node.

    // Description: This method finds a target text node and then injects an element into the appropriate node
    // Rationale: The possibility that cfi marker elements have been injected into a text node at some point previous to 
    //   this method being called (and thus splitting the original text node into two separate text nodes) necessitates that
    //   the set of nodes that compromised the original target text node are inferred and returned.
    // Notes: Passed a current node. This node should have a set of elements under it. This will include at least one text node, 
    //   element nodes (maybe), or possibly a mix. 
    // REFACTORING CANDIDATE: This method is pretty long (and confusing). Worth investigating to see if it can be refactored into something clearer.
    inferTargetTextNode : function (CFIStepValue, $currNode, classBlacklist, elementBlacklist, idBlacklist) {
        
        var $elementsWithoutMarkers;
        var currLogicalTextNodeIndex;
        var targetLogicalTextNodeIndex;
        var nodeNum;
        var $targetTextNodeList;
        var prevNodeWasTextNode;

        // Remove any cfi marker elements from the set of elements. 
        // Rationale: A filtering function is used, as simply using a class selector with jquery appears to 
        //   result in behaviour where text nodes are also filtered out, along with the class element being filtered.
        $elementsWithoutMarkers = this.applyBlacklist($currNode.contents(), classBlacklist, elementBlacklist, idBlacklist);

        // Convert CFIStepValue to logical index; assumes odd integer for the step value
        targetLogicalTextNodeIndex = ((parseInt(CFIStepValue) + 1) / 2) - 1;

        // Set text node position counter
        currLogicalTextNodeIndex = 0;
        prevNodeWasTextNode = false;
        $targetTextNodeList = $elementsWithoutMarkers.filter(
            function () {

                if (currLogicalTextNodeIndex === targetLogicalTextNodeIndex) {

                    // If it's a text node
                    if (this.nodeType === Node.TEXT_NODE || this.nodeType === Node.COMMENT_NODE || this.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
                        prevNodeWasTextNode = true;
                        return true;
                    }
                    // Rationale: The logical text node position is only incremented once a group of text nodes (a single logical
                    //   text node) has been passed by the loop. 
                    else if (prevNodeWasTextNode && (this.nodeType !== Node.TEXT_NODE)) {
                        currLogicalTextNodeIndex++;
                        prevNodeWasTextNode = false;
                        return false;
                    }
                }
                // Don't return any elements
                else {

                    if (this.nodeType === Node.TEXT_NODE || this.nodeType === Node.COMMENT_NODE || this.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
                        prevNodeWasTextNode = true;
                    }else if (!prevNodeWasTextNode && this.nodeType === Node.ELEMENT_NODE){
                        currLogicalTextNodeIndex++;
                        prevNodeWasTextNode = true;
                    }
                    else if (prevNodeWasTextNode && (this.nodeType !== Node.TEXT_NODE) && (this !== $elementsWithoutMarkers.lastChild)) {
                        currLogicalTextNodeIndex++;
                        prevNodeWasTextNode = false;
                    }

                    return false;
                }
            }
        );

        // The filtering above should have counted the number of "logical" text nodes; this can be used to 
        // detect out of range errors
        if ($targetTextNodeList.length === 0) {
            throw cfiRuntimeErrors.OutOfRangeError(targetLogicalTextNodeIndex, currLogicalTextNodeIndex, "Index out of range");
        }

        // return the text node list
        return $targetTextNodeList;
    },

    applyBlacklist : function ($elements, classBlacklist, elementBlacklist, idBlacklist) {
        var self = this;
        var $filteredElements;

        $filteredElements = $elements.filter(
            function () {

                var element = this;

                if (classBlacklist && classBlacklist.length) {
                    var classList = self._getClassNameArray(element);
                    if (classList.length === 1 && _.contains(classBlacklist, classList[0])) {
                        return false;
                    } else if (classList.length && _.intersection(classBlacklist, classList).length) {
                        return false;
                    }
                }

                if (elementBlacklist && elementBlacklist.length) {
                    if (element.tagName) {
                        var isElementBlacklisted = _.find(elementBlacklist, function (blacklistedTag) {
                            blacklistedTag = blacklistedTag.toLowerCase();
                            return self._matchesLocalNameOrElement(element, blacklistedTag)
                        });
                        if (isElementBlacklisted) {
                            return false;
                        }
                    }
                }

                if (idBlacklist && idBlacklist.length) {
                    var id = element.id;
                    if (id && id.length && _.contains(idBlacklist, id)) {
                        return false;
                    }
                }

                return true;
            }
        );

        return $filteredElements;
    },

    _matchesLocalNameOrElement: function (element, otherNameOrElement) {
        if (typeof otherNameOrElement === 'string') {
            return (element.localName || element.nodeName) === otherNameOrElement;
        } else {
            return element === otherNameOrElement;
        }
    },

    _getClassNameArray: function (element) {
        var className = element.className;
        if (typeof className === 'string') {
            return className.split(/\s/);
        } else if (typeof className === 'object' && 'baseVal' in className) {
            return className.baseVal.split(/\s/);
        } else {
            return [];
        }
    }
};

return obj;
}










if (typeof define == 'function' && typeof define.amd == 'object') {
    //console.log("RequireJS ... cfi_instructions");
    
    define(['jquery', 'underscore', './cfi_runtime_errors'],
    function ($, _, cfiRuntimeErrors) {
        return init($, _, cfiRuntimeErrors);
    });
} else {
    //console.log("!RequireJS ... cfi_instructions");
    
    if (!global["EPUBcfi"]) {
        throw new Error("EPUBcfi not initialised on global object?! (window or this context)");
    }
    global.EPUBcfi.CFIInstructions = 
    init($, _,
        {
            NodeTypeError: global.EPUBcfi.NodeTypeError,
            OutOfRangeError: global.EPUBcfi.OutOfRangeError,
            TerminusError: global.EPUBcfi.TerminusError,
            CFIAssertionError: global.EPUBcfi.CFIAssertionError
        });
}

})(typeof window !== "undefined" ? window : this);
