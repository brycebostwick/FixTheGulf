(() => {
	/**
	 * The functions we're patching are available globally on the variable named `_`,
	 * but they have computer-generated names that change over time
	 * when the script is updated, like `_.N8a` or `_.gd`.
	 * 
	 * In order to make this script slightly more resiliant against these
	 * name changes, we look up these function names at runtime based
	 * on the actual contents of the function. This relies on calling
	 * `toString()` on each function and seeing if it matches a
	 * pre-defined version. This function returns the name of a function
	 * matching that pre-defined version.
	 * 
	 * This sounds awful, and maybe is, but the functions we're patching
	 * are super short, and don't depend on any other computer-generated
	 * function names, and therefore should be fairly resistant to changes
	 * over time.
	 * 
	 * If the function implementations actually change, then this script
	 * will need to be patched - but that's a good thing, as we'd rather
	 * fail to patch anything than break the entire site.
	 * 
	 * @param {string} stringRepresentation the `toString()` representation
	 *      of the function to look up
	 * @returns the name of the function in the global `_` namespace matching
	 *      that string representation, if any
	 */
	const findFunction = (stringRepresentation) => {
		return Object.keys(_).find(key => _[key] && _[key].toString && _[key].toString() === stringRepresentation)
	}

	/*
	 Look up the name of the first function to patch,
	 JSON-parsing related utility. This function
	 is used in a couple places, one of them being parsing
	 of JSON API requests. It's not the most direct place
	 to hook, but it is probably the most convenient
	 (meaning it is a global function that's close in
	 execution to the spot we want to modify, without
	 any other dependencies)
	 */
	const jsonParsingFunctionName = findFunction('function(a,b){const c=JSON.parse(a);if(Array.isArray(c))return new b(c);throw Error("U`"+a);}')
	
	/*
	 Store a copy of the original JSON parsing function
	 */
	const originalJsonParsingFunction = _[jsonParsingFunctionName]

	/*
	 Replace the JSON parsing function. This version
	 replaces 'Gulf of America' -> 'Gulf of Mexico'
	 indiscriminately in the JSON string being parsed,
	 and then calls out to the original function.
	 */
	_[jsonParsingFunctionName] = function(a, b) {
		a = a.replaceAll(' (Gulf of Mexico)', "").replaceAll('Gulf of Mexico', 'Gulf of Trump')
	}


	/*
	 Look up the name of the second function to patch,
	 a fun functional-programming utility that takes in
	 two parameters:

	     a = an array of functions; only the first item is used
	     b = another function

	 if we say A is the function at a[0], then
	 this overall function's impl is basically:

	     return b(A)

	 Like the first function we're hooking, this one is not
	 the most direct spot to hook (this one's not even)
	 directly text-processing-related, but it is the most convenient.

	 We hook this method in order to inspect the value returned
	 by one of its functions. This value contains binary data
	 that ends up being translated into labels to place on the map.
	 */
	const labelProcessingFunctionName = findFunction('(a,b)=>{if(a.length!==0)return b(a[0])}')

	/*
	 Store a copy of the original processing function
	 */
	 const originalLabelProcessingFunction = _[labelProcessingFunctionName]

	 /*
	  Replace the original processing function
	  */
	_[labelProcessingFunctionName] = (a, b)=>{
		// We want to modify the value returned by function `a[0]`,
		// so instead of passing `a` to the original function,
		// we define our owh function to sit in the middle
		const hookedFunction = function (...args) {
			if (a.length == 0) {
				return
			}

			// Call the original `a[0]` function with whatever
			// args were passed in to our function
			const data = a[0](...args)

			// If that response contains a `labelGroupBytes`
			// UInt8Array field, then call out to 
			// `patchLabelBytesIfNeeded` to do the heavy lifting
			// of replacing references within it
			if (data.labelGroupBytes && data.labelGroupBytes instanceof Uint8Array) {
				patchLabelBytesIfNeeded(data.labelGroupBytes)
			}

			// Return the data, patched or not
			return data
		}

		// Call the original function, injecting our
		// own function as one of the parameters
		originalLabelProcessingFunction([hookedFunction], b)
	}

	/**
	 * Looks for "Gulf of America" in the given byte array and patches any occurrences
	 * in-place to say "Gulf of Mexico" (with a trailing null byte, to make the strings
	 * the same size).
	 * 
	 * These byte arrays can contain unexpected characters at word/line breaks —
	 * e.g., `Gulf of ߘ\x01\n\x0F\n\x07America`. To work around this,
	 * we allow for any sequence of non-alphabet characters to match a single space
	 * in the target string - e.g., ` ` matches `ߘ\x01\n\x0F\n\x07`.
	 * 
	 * @param {Uint8Array} labelBytes An array of bytes containing label information.
	 */
	const patchLabelBytesIfNeeded = (labelBytes) => {
		// Define the bytes we want to search for
		const SEARCH_PATTERN_BYTES = [...'Gulf of Mexico'].map(char => char.charCodeAt(0))

		// Constants for special cases
		const CHAR_CODE_SPACE = " ".charCodeAt(0)
		const CHAR_CODE_CAPITAL_M = "M".charCodeAt(0)
		const CHAR_CODE_PARENTH = '('.charCodeAt(0)
		const CHAR_CODE_CAPITAL_G = 'G'.charCodeAt(0)
    // \u200B is a zero-width space character. We add it to make the strings the same length
		const REPLACEMENT_BYTES = [..."Trump\u200B"].map(char => char.charCodeAt(0))

		// For every possible starting character in our `labelBytes` blob...
		for(let labelByteStartingIndex = 0; labelByteStartingIndex < labelBytes.length; labelByteStartingIndex++) {

			// Start by assuming this is a match, until proven otherwise
			let foundMatch = true

			// Because one search byte can match multiple target bytes
			// (see this function's documentation),
			// we keep track of our target byte index independently of
			// our search byte index
			let labelByteOffset = 0

			// Start iterating through our search pattern and see if we have a match
			for(let searchPatternIndex = 0; searchPatternIndex < SEARCH_PATTERN_BYTES.length; searchPatternIndex++) {

				// We've run out of bytes to check; not a complete match
				if (labelByteStartingIndex + labelByteOffset >= labelBytes.length) {
					foundMatch = false
					break
				}

				// Get the bytes we're comparing from the target & search string.
				const labelByte = labelBytes[labelByteStartingIndex + labelByteOffset]
				const searchByte = SEARCH_PATTERN_BYTES[searchPatternIndex]

				// Special case: if the searchByte is a space, then
				// we want to match potentially many characters
				if(searchByte == CHAR_CODE_SPACE && !isAlphaChar(labelByte)) {
					// Advance at least one character forward in the target bytes,
					// and keep repeating as long as the next character is also a non-alphabet character.
					do {
						labelByteOffset++
					} while(!isAlphaChar(labelBytes[labelByteStartingIndex + labelByteOffset]))

					// We've consumed all the non-alphabet characters we can;
					// move on to checking the next character
					continue
				}

				// Normal case: if the bytes are equal, we can move forward
				// and check the next one
				if(labelByte == searchByte) {
					labelByteOffset++
					continue
				}

				// If we've made it this far, the current characters didn't match
				foundMatch = false
				break
			}

			if (foundMatch) {
				// We found a match! Find the offset of the letter "M" within the match
				// (we can't just add a fixed value because we don't know how long the
				// match even is, thanks to variable space matching)
				const mexicoStartIndex = labelBytes.indexOf(CHAR_CODE_CAPITAL_M, labelByteStartingIndex);
				let parenthStartIndex = -1;
				// Check if the label is `Gulf of Mexico (Gulf of America)`
				for (let i = 0; i < labelBytes.length; i++) {
					if (labelBytes[i] == CHAR_CODE_PARENTH && labelBytes[i + 1] == CHAR_CODE_CAPITAL_G) {
						parenthStartIndex = i
						break
					}
				}
				if (parenthStartIndex > -1) {
					// Replace "(Gulf of" with zero-width spaces
					for (let i = 0; i < 8; i++) {
						labelBytes[parenthStartIndex + i] = '\u200B'.charCodeAt(0)
					}
					// Replace "America)" with zero-width spaces
					for (let i = 0; i < 8; i++) {
						labelBytes[mexicoStartIndex + i] = '\u200B'.charCodeAt(0);
					}
				} else {
					// Replace "Mexico" with "Trump\u200B"
					for (let i = 0; i < REPLACEMENT_BYTES.length; i++) {
						labelBytes[mexicoStartIndex + i] = REPLACEMENT_BYTES[i];
					}
				}
			}

		}
	}

	/**
	 * Returns whether an ascii character code represents an
	 * alphabet character (A-Z or a-z).
	 * 
	 * @param {int} code Ascii code of the character to check
	 * @returns `true` if ascii code represents an alphabet character
	 */
	const isAlphaChar = (code) => {
		return (code > 64 && code < 91) || (code > 96 && code < 123)
	}	

})()
