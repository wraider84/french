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
const addCardBtn = document.getElementById('addCardBtn'); // We'll keep this for adding new cards via UI


// --- Card Data Structure ---
// {
//     id: uniqueId,
//     front: 'French phrase',
//     back: 'English translation',
//     lastReviewed: null, // Date object or timestamp of last review
//     interval: 0,       // Days until next review
//     easeFactor: 2.5,   // From SM-2 algorithm, how easy it is (starts at 2.5)
//     repetitions: 0     // Consecutive correct recalls
// }

let cards = []; // Array to hold all flashcards (merged from CSV and localStorage)
let currentCardIndex = -1;
let reviewQueue = [];
let currentCard = null;

const CSV_FILE_PATH = 'french/cards.csv'; // Define the path to your CSV file

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

        // We only care about 'front' and 'back' for now.
        // We'll generate the SRS properties if the card is new or from CSV
        if (cardData.front && cardData.back) {
             parsedCards.push({
                front: cardData.front,
                back: cardData.back,
                // These will be merged with localStorage data
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

    reviewQueue.sort(() => Math.random() - 0.5);
    updateCardsRemainingDisplay();
}

function displayNextCard() {
    if (flashcard.classList.contains('flipped')) {
        flashcard.classList.remove('flipped');
    }
    showAnswerBtn.style.display = 'block';
    ratingButtons.style.display = 'none';

    if (reviewQueue.length === 0) {
        cardFront.textContent = "All done for today!";
        cardBack.textContent = "Come back later for new cards or add more!";
        flashcard.style.cursor = 'default';
        showAnswerBtn.style.display = 'none';
        return;
    }

    currentCard = reviewQueue.shift();
    cardFront.textContent = currentCard.front;
    cardBack.textContent = currentCard.back;
    updateCardsRemainingDisplay();
}

function updateCardsRemainingDisplay() {
    cardsRemainingText.textContent = `Cards to review: ${reviewQueue.length}`;
}

// --- Event Listeners ---

flashcard.addEventListener('click', () => {
    if (currentCard) {
        flashcard.classList.toggle('flipped');
        if (flashcard.classList.contains('flipped')) {
            showAnswerBtn.style.display = 'none';
            ratingButtons.style.display = 'flex';
        } else {
            showAnswerBtn.style.display = 'block';
            ratingButtons.style.display = 'none';
        }
    }
});

showAnswerBtn.addEventListener('click', () => {
    if (currentCard) {
        flashcard.classList.add('flipped');
        showAnswerBtn.style.display = 'none';
        ratingButtons.style.display = 'flex';
    }
});

ratingButtons.addEventListener('click', (event) => {
    if (!currentCard) return;

    const button = event.target.closest('.rating-btn');
    if (!button) return;

    let quality;
    if (button.id === 'againBtn') quality = 0;
    else if (button.id === 'hardBtn') quality = 1;
    else if (button.id === 'partialBtn') quality = 2;
    else if (button.id === 'goodBtn') quality = 3;
    else if (button.id === 'easyBtn') quality = 4;

    sm2Algorithm(currentCard, quality);
    
    const existingCardIndex = cards.findIndex(c => c.id === currentCard.id);
    if (existingCardIndex !== -1) {
        cards[existingCardIndex] = currentCard;
    } else {
        cards.push(currentCard); 
    }

    saveCards();

    if (quality < 3) {
        reviewQueue.push(currentCard);
    }
    
    displayNextCard();
});

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
    cards.push(newCard);
    saveCards();
    getCardsToReviewToday(); // Re-populate queue to include the new card
    displayNextCard();
});


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => { // Made async to await CSV load
    await loadCards(); // Await the loading of cards from CSV and localStorage
    getCardsToReviewToday();
    displayNextCard();
});
