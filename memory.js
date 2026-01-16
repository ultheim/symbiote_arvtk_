// ============================================
// MEMORY MODULE (memory.js) - HYBRID ATOMIC SYSTEM
// ============================================

window.hasRestoredSession = false;

// --- 1. INITIALIZE SESSION ---
window.initializeSymbiosisSession = async function() {
    const appsScriptUrl = localStorage.getItem("symbiosis_apps_script_url");
    if (!appsScriptUrl) return;

    try {
        console.log("🔄 Restoring Short-term Memory...");
        const req = await fetch(appsScriptUrl, {
            method: "POST",
			mode: "cors",			
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "get_recent_chat" })
        });
        const res = await req.json();
        
        if (res.history && Array.isArray(res.history)) {
            window.chatHistory = res.history.map(row => ({ 
                role: row[1], 
                content: row[2], 
                timestamp: row[0] 
            }));
            
            // Time Gap Logic
            if (window.chatHistory.length > 0) {
                const lastMsg = window.chatHistory[window.chatHistory.length - 1];
                const lastTime = new Date(lastMsg.timestamp).getTime();
                const now = new Date().getTime();
                const hoursDiff = (now - lastTime) / (1000 * 60 * 60);

                if (hoursDiff > 6) {
                    console.log(`🕒 Time Gap Detected: ${hoursDiff.toFixed(1)} hours`);
                    window.chatHistory.push({
                        role: "system",
                        content: `[SYSTEM_NOTE: The user has returned after ${Math.floor(hoursDiff)} hours. Treat this as a new session context, but retain previous memories.]`
                    });
                }
            }
            console.log("✅ Session Restored:", window.chatHistory.length, "msgs");
        }
    } catch (e) { console.error("Session Restore Failed", e); }
};

// --- SYNAPTIC RETRY ENGINE ---
async function fetchWithCognitiveRetry(messages, model, apiKey, validatorFn, label) {
    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const req = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST", 
                headers: { 
                    "Authorization": `Bearer ${apiKey}`, 
                    "Content-Type": "application/json",
                    "HTTP-Referer": window.location.href,
                    "X-Title": "Symbiosis"
                },
                body: JSON.stringify({ "model": model, "messages": messages })
            });
            const res = await req.json();
            if (!res.choices) throw new Error("Empty Response");
            
            let raw = res.choices[0].message.content;
            let clean = raw.replace(/```json/g, "").replace(/```/g, "");
            let first = clean.indexOf('{'), last = clean.lastIndexOf('}');
            if (first !== -1 && last !== -1) clean = clean.substring(first, last + 1);
            
            const parsed = JSON.parse(clean);
            if (validatorFn(parsed)) return { parsed: parsed, cleaned: clean };
        } catch (e) { console.warn(`${label} Retry ${attempt}...`); }
    }
    throw new Error(`${label} Failed.`);
}

// --- MAIN PROCESS ---
window.processMemoryChat = async function(userText, apiKey, modelHigh, modelLow, history = [], isQuestionMode = false) {
    const appsScriptUrl = localStorage.getItem("symbiosis_apps_script_url");
    
    // Log User Input
    if (appsScriptUrl) {
        fetch(appsScriptUrl, { 
            method: "POST", 
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "log_chat", role: "user", content: userText }) 
        }).catch(e => console.error("Log failed", e));
    }

    // --- STEP 0: AI RELATIONSHIP RESOLVER (The Fix) ---
    // We ask the LLM to identify people and give us SYNONYMS (Dad -> Father)
    let relationshipContext = "";
    if (appsScriptUrl) {
        const relPrompt = `
        INPUT: "${userText}"
        TASK: Identify if the user mentions any PEOPLE or RELATIONSHIPS.
        If found, return the word AND its formal synonyms.
        
        EXAMPLE: 
        Input: "My dad is eating" -> Output: ["dad", "father", "parent"]
        Input: "I hate spinach" -> Output: []
        Input: "Ferdy is here" -> Output: ["Ferdy"]
        
        RETURN JSON: { "keywords": [...] }
        `;

        try {
            // 1. Ask Lite Model to expand terms
            const relCheck = await fetchWithCognitiveRetry(
                [{ "role": "system", "content": relPrompt }],
                modelHigh, apiKey, (d) => Array.isArray(d.keywords), "Rel Check"
            );

            const searchTargets = relCheck.parsed.keywords || [];

            if (searchTargets.length > 0) {
                console.log("🔍 AI Expanded Relationships:", searchTargets);
                
                // 2. Search DB for ALL synonyms (e.g. "Dad" AND "Father")
                const relReq = await fetch(appsScriptUrl, {
                    method: "POST", 
                    headers: { "Content-Type": "text/plain" },
                    body: JSON.stringify({ 
                        action: "retrieve_complex", 
                        owner: "Arvin", 
                        keywords: searchTargets 
                    })
                });
                const relRes = await relReq.json();
                
                if (relRes.found && relRes.relevant_memories.length > 0) {
                    relationshipContext = `KNOWN RELATIONSHIPS:\n${relRes.relevant_memories.join("\n")}`;
                    console.log("✅ Relationship Context Found:", relationshipContext);
                }
            }
        } catch(e) { console.warn("Rel check skipped", e); }
    }

    const historyText = history.map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join("\n");
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    // 1. SENSORY ANALYSIS (Flash Lite)
    const synthPrompt = `
    USER_IDENTITY: Arvin. (Assume "I", "me" refers to Arvin).
    CURRENT_DATE: ${today}
    HISTORY_CONTEXT: ${historyText.slice(-600)}
    RELATIONSHIP_DB: ${relationshipContext}
    INPUT: "${userText}"
    
    TASK: Hybrid Analysis
    1. CONTEXTUAL RESOLUTION: 
       - Resolve pronouns (he/she/it) based on HISTORY.
       - RESOLVE OWNERS using RELATIONSHIP_DB: 
         > If INPUT is "Dad hates spinach" and DB says "Ferdy is Arvin's father", the OWNER is "Ferdy".
         > If DB is empty, default to "Arvin's Father".
       
    2. ATOMIC ENTRIES: Extract new facts to store.
       - If the user provides a date or detail (e.g. "In 2022") answering a previous question, COMBINE it with the context to create a full fact.
	   - Compare INPUT against HISTORY_CONTEXT and RELATIONSHIP_DB.
         > If the fact is ALREADY KNOWN (e.g. Input: "I was born in 1995" AND DB says: "Arvin was born on May 14, 1995"), DO NOT EXTRACT IT. Return empty [].
         > Only extract info that is NEW, UPDATED, or CONTRADICTORY.
	   - Ignore questions/commands.
       - OWNER: The Subject of the fact (Use the Real Name if found in DB).
       - IMPORTANCE: 1-10.
       - TYPE: Select ONE from:
          * "Bio" (Permanent traits, history, relationships, likes/dislikes).
          * "Psych" (Inner thoughts, fears, mental state, personality).
          * "Status" (Temporary state, current location, current activity).
          * "Log" (General events or trivial actions).
       - TOPICS: Select ONE from [Identity, Preference, Location, Relationship, History, Work, Dream, Health, Trivial].
       - TEMPORAL AMBIGUITY: Set "ambiguous": true IF a specific past event is mentioned without a date.
       
    3. SEARCH KEYWORDS: Extract database search terms.
       - Include ALL relevant TOPICS from the list above (more than 1).
         > Example: "How was my relationship with Dad?" -> Keywords: ["Relationship", "History", "Ferdy"]
         > Example: "Where did I work?" -> Keywords: ["Work", "History", "Location"]
	
	4. QUERY SUBJECT: Who is the user asking about? 
       - If "Who is Brandon?", subject is "Brandon".
       - If "I am happy", subject is "Arvin".
       - Default to "Arvin".
    
    Output JSON: {
      "entries": [ 
         { "fact": "...", "importance": 8, "owner": "...", "type": "...", "topics": "...", "ambiguous": false } 
      ],
      "search_keywords": ["Preference", "Food"], "query_subject": "..."
    }
    `;

    console.log("🧠 1. Analyzing..."); 
    let atomicEntries = [];
    let searchKeys = [];
	let querySubject = "Arvin";
    
    try {
        const synthResult = await fetchWithCognitiveRetry(
            [{ "role": "system", "content": synthPrompt }],
            modelHigh, // Use Lite
            apiKey,
            (data) => Array.isArray(data.entries), 
            "Sensory Analysis"
        );
        atomicEntries = synthResult.parsed.entries;
        searchKeys = synthResult.parsed.search_keywords || [];
		querySubject = synthResult.parsed.query_subject || "Arvin";
        console.log("📊 Entries:", atomicEntries, "Subject:", querySubject);
    } catch (e) { console.error("Analysis Failed", e); }

    // --- TIMELINE INTERCEPTOR ---
    const unclearMemory = atomicEntries.find(e => e.importance >= 6 && e.ambiguous === true);
    if (unclearMemory) {
        console.warn("⚠️ Interceptor Triggered: Missing Date");
        const interceptPrompt = `
        User said: "${userText}"
        Fact: "${unclearMemory.fact}"
        ISSUE: Significant event missing date.
        INSTRUCTIONS: Ask "When did this happen?" naturally.
        VALID MOODS: [CURIOUS, CONCERNED]
        Return JSON: { "response": "...", "mood": "CURIOUS", "roots": [] }
        `;
        const interceptResult = await fetchWithCognitiveRetry(
            [{ "role": "system", "content": interceptPrompt }],
            modelHigh, apiKey, (data) => data.response, "Interceptor"
        );
        return { choices: [{ message: { content: interceptResult.cleaned } }] };
    }


    // 2. UNIVERSAL RETRIEVAL (Sticky Context)
    let retrievedContext = "";
    if (appsScriptUrl) {
        // A. Sticky Context (Existing code)
        if (history.length > 0) {
            const lastAi = history.filter(h => h.role === "assistant").pop();
            if (lastAi) {
                const stickyWords = lastAi.content.split(" ")
                    .filter(w => w.length > 5 && /^[a-zA-Z]+$/.test(w))
                    .slice(0, 2); 
                searchKeys = searchKeys.concat(stickyWords);
            }
        }

        // [NEW FIX]: Extract Names from Relationship Context
        // If Step 0 found "Ferdy" or "Indriani", add them to the search!
        if (relationshipContext) {
            const usefulNames = [];
            // Regex to capture text inside [Subject: ...]
            const matches = relationshipContext.matchAll(/\[Subject:\s*([^\]]+)\]/g);
            for (const m of matches) {
                const name = m[1].trim();
                // Filter out Arvin and duplicates
                if (name !== "Arvin" && name.length > 2 && !usefulNames.includes(name)) {
                    usefulNames.push(name);
                }
            }

            searchKeys = searchKeys.concat(usefulNames);
            console.log("➕ Added Relationship Names to Search:", usefulNames);
        }

        // B. Fallback Keywords (Existing code)
        if (searchKeys.length === 0) {
             searchKeys = userText.split(" ")
                .map(w => w.replace(/[^a-zA-Z]/g, "").toLowerCase())
                .filter(w => w.length > 3 && !["what", "when", "where", "show", "list", "give"].includes(w));
        }

        // C. Determine Primary Subject 
        // (Existing logic: use querySubject unless we have a specific new fact owner)
        const primaryOwner = (atomicEntries[0] && atomicEntries[0].owner) ? atomicEntries[0].owner : querySubject;

        try {
            console.log(`🔍 Searching: Owner=[${primaryOwner}] Keys=[${searchKeys}]`);
            const memReq = await fetch(appsScriptUrl, {
			    method: "POST", 
			    mode: "cors", // Mandatory for GitHub Pages
			    redirect: "follow", // Mandatory because Google redirects to a temporary URL
			    headers: { 
			        "Content-Type": "text/plain" // Use text/plain to avoid "Preflight" CORS checks
			    },
			    body: JSON.stringify({ 
			        action: "retrieve_complex", 
			        owner: primaryOwner,
			        keywords: searchKeys 
			    })
			});
            const memRes = await memReq.json();
            
            if (memRes.found) {
                retrievedContext = `
                === SUBJECT CONTEXT (${primaryOwner.toUpperCase()}) ===
                [BIO]: ${memRes.persona.bio}
                [STATUS]: ${memRes.persona.current_status}
                
                === DATABASE SEARCH RESULTS (GLOBAL) ===
                ${memRes.relevant_memories.join("\n")}
                `;
                window.lastRetrievedMemories = retrievedContext; 
            }
        } catch (e) { console.error("Retrieval Error", e); }
    }

    // 3. GENERATION (Flash High)
    const instructions = isQuestionMode ? `MODE: INTERROGATION.` : `MODE: COMPANION.`;
    const finalSystemPrompt = `
    ${instructions}
    
    DATABASE RESULTS: 
    ${retrievedContext}
    
    HISTORY: 
    ${historyText.slice(-800)}
    
    User: "${userText}"
    
	### TASK ###
    1. ANALYZE the Database Results and History.
    2. RESPOND to the User naturally (in character). 
       - Do NOT talk about "compiling data", "JSON", or "processing". Just talk.
       - If you found info, weave it into the conversation (e.g. "I remember you dated Suwandi...").
       - If the user asks a question, answer it directly.
	
    - ROOTS: Array of MAX 3 objects.
    - ROOT LABEL: MUST be exactly 1 word. UPPERCASE.
    - BRANCHES: Max 5 branches. Label MUST be exactly 1 word.
    - LEAVES: Max 5 leaves per branch. Text MUST be exactly 1 word.
    
    CRITICAL INSTRUCTIONS:
    1. DO NOT USE PHRASES. SINGLE WORDS ONLY for labels.
    2. **ASSIGN MOODS**: You MUST assign a specific MOOD to every ROOT and BRANCH based on its sentiment.
       - Example: If the branch is "SPINACH" (which Arvin hates), mood must be "HATE".
       - Example: If the branch is "MUSIC" (which Arvin likes), mood must be "JOYFUL".
    
    MOODS: [NEUTRAL, AFFECTIONATE, CRYPTIC, HATE, JOYFUL, CURIOUS, SAD, QUESTION]

    Return JSON: { 
        "response": "...", 
        "mood": "GLOBAL_MOOD", 
        "roots": [
            { 
                "label": "ROOT_WORD", 
                "mood": "SPECIFIC_MOOD", 
                "branches": [
                    { "label": "BRANCH_WORD", "mood": "SPECIFIC_MOOD", "leaves": ["LEAF1", "LEAF2"] }
                ] 
            }
        ] 
    }
    `;

    const generationResult = await fetchWithCognitiveRetry(
        [{ "role": "user", "content": finalSystemPrompt }],
        modelHigh, 
        apiKey,
        (data) => data.response && data.mood, 
        "Generation"
    );

    // Log AI Response
    if(appsScriptUrl) {
        fetch(appsScriptUrl, { 
            method: "POST", 
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "log_chat", role: "assistant", content: generationResult.parsed.response }) 
        }).catch(e=>{});
    }

    // 4. ATOMIC STORAGE (Fire and Forget)
    if (appsScriptUrl && atomicEntries.length > 0) {
        (async () => {
            for (const entry of atomicEntries) {
                if (entry.importance < 2) continue;
                await fetch(appsScriptUrl, {
                    method: "POST", 
                    headers: { "Content-Type": "text/plain" },
                    body: JSON.stringify({ 
                        action: "store_atomic", 
                        fact: entry.fact, 
                        importance: entry.importance,
                        owner: entry.owner,
                        type: entry.type,
                        entities: entry.owner, 
                        topics: entry.topics 
                    })
                });
            }
        })();
    }

    return { choices: [{ message: { content: generationResult.cleaned } }] };

};

