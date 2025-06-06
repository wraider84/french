// script.js

// --- DOM Elements ---
const flashcard = document.getElementById('flashcard');
const cardFront = document.getElementById('card-front');
const cardBack = document.getElementById('card-back');
const showAnswerBtn = document.getElementById('showAnswerBtn');
const ratingButtons = document.querySelector('.rating-buttons');
const againBtn = document.getElementById('againBtn');
const hardBtn = document.getElementById('hardBtn');
const partialBtn = document.getElementById('partialBtn');
const goodBtn = document.getElementById('goodBtn');
const easyBtn = document.getElementById('easyBtn');
const cardsRemainingText = document.getElementById('cardsRemaining');
const addCardBtn = document.getElementById('addCardBtn');

// --- NEW STATS DOM Elements ---
const sessionReviewedCountText = document.getElementById('sessionReviewedCount');
const newCardsCountText = document.getElementById('newCardsCount');
const learningCardsCountText = document.getElementById('learningCardsCount');
const matureCardsCountText = document.getElementById('matureCardsCount');
const totalCardsCountText = document.getElementById('totalCardsCount');


// --- Card Data Structure ---
// {
//     id: uniqueId,
//     front: 'French phrase',
//     back: 'English translation',
//     lastReviewed: null, // Date object or timestamp of last review
//     interval: 0,        // Days until next review
//     easeFactor: 2.5,    // From SM-2 algorithm, how easy it is (starts at 2.5)
//     repetitions: 0      // Consecutive correct recalls
// }

let cards = []; // Array to hold all flashcards (merged from CSV and localStorage)
let currentCardIndex = -1; // Not strictly used with reviewQueue.shift()
let reviewQueue = []; // Cards currently due for review
let currentCard = null; // The card currently being displayed

let sessionReviewedCount = 0; // NEW: Counter for cards reviewed in the current session

const CSV_FILE_PATH = 'cards.csv'; // Define the path to your CSV file

// --- SM-2 Algorithm Implementation (Modified for 5 qualities) ---
// quality: 0 (Again), 1 (Hard), 2 (Partial), 3 (Good), 4 (Easy)
function sm2Algorithm(card, quality) {
    quality = Math.max(0, Math.min(4, quality));

    if (quality >= 3) { // Good or Easy
        card.repetitions++;

        if (card.repetitions === 1) {
            card.interval = 1;
        } else if (card.repetitions === 2) {
            card.interval = 6;
        } else {
            card.interval = Math.round(card.interval * card.easeFactor);
        }

        card.easeFactor += (0.1 - (4 - quality) * (0.08 + (4 - quality) * 0.02));

    } else { // Incorrect or barely remembered (Again, Hard, Partial)
        // For "Again" (0) or "Hard" (1)
        if (quality <= 1) {
             card.repetitions = 0;
             card.interval = 1;
        } else if (quality === 2) { // If "Partial"
            // For partial, we acknowledge some recall, but it's not perfect.
            // Do not reset repetitions, but make sure interval is short and ease factor takes a hit.
            card.interval = Math.max(1, Math.round(card.interval * 0.5)); // Halve interval, min 1 day
            card.easeFactor -= 0.15; // Moderate decrease in ease factor
        }
    }

    if (card.easeFactor < 1.3) {
        card.easeFactor = 1.3;
    }

    card.lastReviewed = new Date().getTime();
}

// --- CSV Parsing Function ---
// This function takes CSV text and converts it into an array of card objects.
function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== ''); // Split by new line, remove empty lines
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(header => header.trim()); // Get headers from the first line
    const parsedCards = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(','); // Split by comma
        if (values.length !== headers.length) {
            console.warn(`Skipping malformed row: ${lines[i]} (Expected ${headers.length} columns, got ${values.length})`);
            continue; // Skip rows that don't match header count
        }

        const cardData = {};
        for (let j = 0; j < headers.length; j++) {
            cardData[headers[j]] = values[j].trim(); // Assign value to corresponding header
        }

        if (cardData.front && cardData.back) {
             parsedCards.push({
                 front: cardData.front,
                 back: cardData.back,
                 // id, lastReviewed, interval, easeFactor, repetitions will be added/preserved by loadCards
             });
        }
    }
    return parsedCards;
}


// --- Card Loading & Saving Functions ---

async function loadCards() {
    let csvCards = [];
    try {
        const response = await fetch(CSV_FILE_PATH);
        if (!response.ok) {
            console.error(`Failed to load CSV file: ${response.statusText}`);
            // Fallback to local storage if CSV fails to load
            loadCardsFromLocalStorage();
            return;
        }
        const csvText = await response.text();
        csvCards = parseCSV(csvText);
        console.log(`Loaded ${csvCards.length} cards from ${CSV_FILE_PATH}`);
    } catch (error) {
        console.error("Error fetching or parsing CSV:", error);
        // Fallback to local storage if there's any error with CSV
        loadCardsFromLocalStorage();
        return;
    }

    // Load cards from local storage (these contain review data)
    let storedCards = [];
    const storedCardsJson = localStorage.getItem('frenchFlashcards');
    if (storedCardsJson) {
        storedCards = JSON.parse(storedCardsJson);
    }

    // Merge CSV cards with stored cards, preserving review data
    // Prioritize review data from localStorage if a card with the same front/back exists
    const mergedCardsMap = new Map();

    // Add stored cards first (they have review data)
    storedCards.forEach(card => {
        // Create a unique key for merging, e.g., "FrenchPhrase||EnglishTranslation"
        const key = `${card.front.trim()}||${card.back.trim()}`;
        mergedCardsMap.set(key, card);
    });

    // Add/update CSV cards
    csvCards.forEach(csvCard => {
        const key = `${csvCard.front.trim()}||${csvCard.back.trim()}`;
        if (mergedCardsMap.has(key)) {
            // Card exists in localStorage, keep its review data
            // But update front/back just in case CSV has corrections
            const existingCard = mergedCardsMap.get(key);
            existingCard.front = csvCard.front;
            existingCard.back = csvCard.back;
        } else {
            // New card from CSV, add it with default SRS properties and a new ID
            mergedCardsMap.set(key, {
                id: Date.now() + Math.random(), // Ensure unique ID
                front: csvCard.front,
                back: csvCard.back,
                lastReviewed: null,
                interval: 0,
                easeFactor: 2.5,
                repetitions: 0
            });
        }
    });

    cards = Array.from(mergedCardsMap.values());

    // Ensure all necessary properties exist for any card (for backward compatibility)
    cards.forEach(card => {
        if (card.id === undefined) card.id = Date.now() + Math.random();
        if (card.lastReviewed === undefined) card.lastReviewed = null;
        if (card.interval === undefined) card.interval = 0;
        if (card.easeFactor === undefined) card.easeFactor = 2.5;
        if (card.repetitions === undefined) card.repetitions = 0;
    });

    saveCards(); // Save the merged card set
}

function loadCardsFromLocalStorage() {
    const storedCards = localStorage.getItem('frenchFlashcards');
    if (storedCards) {
        cards = JSON.parse(storedCards);
        cards.forEach(card => {
            if (card.id === undefined) card.id = Date.now() + Math.random();
            if (card.lastReviewed === undefined) card.lastReviewed = null;
            if (card.interval === undefined) card.interval = 0;
            if (card.easeFactor === undefined) card.easeFactor = 2.5;
            if (card.repetitions === undefined) card.repetitions = 0;
        });
    } else {
        // No cards in localStorage, and CSV load failed, so start with an empty set
        cards = [];
        console.warn("No CSV loaded and no cards found in local storage. Start by adding a new card.");
    }
}

function saveCards() {
    localStorage.setItem('frenchFlashcards', JSON.stringify(cards));
}

function getCardsToReviewToday() {
    const now = new Date().getTime();
    const today = new Date(now).setHours(0, 0, 0, 0);

    reviewQueue = cards.filter(card => {
        if (!card.lastReviewed) {
            return true; // New cards are always due
        }
        const nextReviewDate = new Date(card.lastReviewed + card.interval * 24 * 60 * 60 * 1000);
        return nextReviewDate.setHours(0, 0, 0, 0) <= today;
    });

    reviewQueue.sort(() => Math.random() - 0.5); // Randomize the queue
    updateCardsRemainingDisplay(); // Update cards remaining text
}

function displayNextCard() {
    // Ensure the card is not flipped when a new one is loaded/displayed
    flashcard.classList.remove('flipped');

    showAnswerBtn.style.display = 'block'; // Show "Show Answer" button
    ratingButtons.style.display = 'none'; // Hide rating buttons

    if (reviewQueue.length === 0) {
        cardFront.textContent = "All done for today!";
        cardBack.textContent = "Come back later for new cards or add more!";
        flashcard.style.cursor = 'default'; // Change cursor
        showAnswerBtn.style.display = 'none'; // Hide "Show Answer"
        return; // Exit as no cards to display
    }

    currentCard = reviewQueue.shift(); // Get the next card from the queue
    cardFront.textContent = currentCard.front; // Set front content
    cardBack.textContent = currentCard.back; // Set back content
    updateCardsRemainingDisplay(); // Update cards remaining text
}

function updateCardsRemainingDisplay() {
    cardsRemainingText.textContent = `Cards to review: ${reviewQueue.length}`;
}

// --- NEW FUNCTION: Update Stats Display ---
function updateStatsDisplay() {
    sessionReviewedCountText.textContent = sessionReviewedCount; // Update cards reviewed in session

    // Categorize all cards for overall progress
    const newCards = cards.filter(card => card.repetitions === 0);
    // Learning cards: have been reviewed at least once but interval is still relatively short (e.g., less than 30 days)
    const learningCards = cards.filter(card =>
        card.repetitions > 0 && card.interval < 30
    );
    // Mature cards: have a sufficiently long interval (e.g., 30 days or more)
    const matureCards = cards.filter(card =>
        card.interval >= 30
    );

    newCardsCountText.textContent = newCards.length;
    learningCardsCountText.textContent = learningCards.length;
    matureCardsCountText.textContent = matureCards.length;
    totalCardsCountText.textContent = cards.length; // Total cards loaded in the system
}


// --- Event Listeners ---

// Flashcard click to flip
flashcard.addEventListener('click', () => {
    if (currentCard) { // Only flip if there's a card displayed
        flashcard.classList.toggle('flipped');
        if (flashcard.classList.contains('flipped')) {
            showAnswerBtn.style.display = 'none'; // Hide "Show Answer" when flipped
            ratingButtons.style.display = 'flex'; // Show rating buttons
        } else {
            showAnswerBtn.style.display = 'block'; // Show "Show Answer" when not flipped
            ratingButtons.style.display = 'none'; // Hide rating buttons
        }
    }
});

// "Show Answer" button click
showAnswerBtn.addEventListener('click', () => {
    if (currentCard) { // Only show answer if a card is displayed
        flashcard.classList.add('flipped'); // Force flip to back
        showAnswerBtn.style.display = 'none'; // Hide "Show Answer" button
        ratingButtons.style.display = 'flex'; // Show rating buttons
    }
});

// Rating buttons container click (delegated listener)
ratingButtons.addEventListener('click', (event) => {
    if (!currentCard) return; // Ensure there's a current card to avoid errors

    const button = event.target.closest('.rating-btn');
    if (!button) return; // Exit if a non-button element was clicked inside the container

    // Determine the quality score based on the clicked button's ID
    let quality;
    if (button.id === 'againBtn') quality = 0;
    else if (button.id === 'hardBtn') quality = 1;
    else if (button.id === 'partialBtn') quality = 2;
    else if (button.id === 'goodBtn') quality = 3;
    else if (button.id === 'easyBtn') quality = 4;

    // Apply the SM-2 algorithm to update the current card's properties (interval, easeFactor, repetitions)
    sm2Algorithm(currentCard, quality);
    
    // Find the current card in your main 'cards' array by its ID
    const existingCardIndex = cards.findIndex(c => c.id === currentCard.id);
    if (existingCardIndex !== -1) {
        // If found, update its details with the newly calculated SRS properties
        cards[existingCardIndex] = currentCard;
    } else {
        // This case should ideally not happen if cards are loaded correctly, but it's a safeguard
        cards.push(currentCard); 
    }

    // Save all cards (with the updated currentCard) back to local storage
    saveCards();

    // If the card was rated 'Again', 'Hard', or 'Partial' (quality < 3),
    // push it back to the reviewQueue so it can be reviewed again sooner.
    if (quality < 3) { // 0=Again, 1=Hard, 2=Partial
        reviewQueue.push(currentCard);
    }
    
    // --- START OF NEW LOGIC FOR FLIPPING CURRENT CARD & DISPLAYING NEXT CARD ---

    // 1. Immediately flip the current card back to its front side
    // This allows the user to briefly see the front of the card they just reviewed.
    flashcard.classList.remove('flipped'); 
    
    // 2. Introduce a small delay before proceeding to the next card.
    // This pause gives a better visual transition and user experience.
    setTimeout(() => {
        sessionReviewedCount++; // Increment count for cards reviewed in this session
        updateStatsDisplay();   // Update all stat numbers
        
        // 3. Re-evaluate which cards are due for review today.
        // This is important because the 'currentCard' just had its review date updated.
        getCardsToReviewToday(); 

        // 4. Check if there are any cards left in the review queue.
        if (reviewQueue.length === 0) {
            // If no more cards are left for today, display the "All done" message.
            cardFront.textContent = "All done for today!";
            cardBack.textContent = "Come back later for new cards or add more!";
            flashcard.style.cursor = 'default';      // Change cursor
            showAnswerBtn.style.display = 'none';    // Hide "Show Answer" button
            ratingButtons.style.display = 'none';    // Hide rating buttons
            flashcard.classList.remove('flipped');   // Ensure the "All done" message stays on the front
        } else {
            // If there are cards left, get the next card from the queue.
            currentCard = reviewQueue.shift(); 
            // Display the next card. The 'displayNextCard' function already ensures
            // the card starts on its front, which is perfect for this flow.
            displayNextCard(); 
        }
    }, 300); // 300 milliseconds delay (0.3 seconds). You can adjust this value.

    // --- END OF NEW LOGIC ---
});

// "Add New Card" button click
addCardBtn.addEventListener('click', () => {
    const newFront = prompt("Enter the French word/phrase:");
    if (newFront === null || newFront.trim() === "") return;

    const newBack = prompt("Enter the English translation:");
    if (newBack === null || newBack.trim() === "") return;

    // Check if a card with the same front/back already exists to avoid duplicates
    const existingCard = cards.find(card => 
        card.front.trim() === newFront.trim() && 
        card.back.trim() === newBack.trim()
    );

    if (existingCard) {
        alert("This card already exists!");
        return;
    }

    const newCard = {
        id: Date.now() + Math.random(), // Unique ID for the new card
        front: newFront.trim(),
        back: newBack.trim(),
        lastReviewed: null,
        interval: 0,
        easeFactor: 2.5,
        repetitions: 0
    };
    cards.push(newCard); // Add the new card to the main cards array
    saveCards(); // Save all cards to local storage
    getCardsToReviewToday(); // Re-populate queue to include the new card (if due)
    displayNextCard(); // Display the next card (might be the new one if due)
    updateStatsDisplay(); // Update stats to reflect the new card count
});


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadCards(); // Await the loading of cards from CSV and localStorage
    getCardsToReviewToday(); // Populate the review queue
    displayNextCard(); // Display the first card
    updateStatsDisplay(); // Call this to show initial stats
});
