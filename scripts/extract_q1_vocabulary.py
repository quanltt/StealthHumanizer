import os
import json
import re
import argparse
from collections import Counter
try:
    import nltk
    from nltk.corpus import stopwords
    from nltk.tokenize import word_tokenize
except ImportError:
    print("Please install nltk: pip install nltk")
    exit(1)

# Ensure NLTK data is downloaded
try:
    stopwords.words('english')
except LookupError:
    nltk.download('stopwords')
    nltk.download('punkt')

def process_file(filepath):
    """Extract text from a file (handles basic txt, for PDF integration add PyPDF2)."""
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()

def extract_vocabulary(text_corpus, top_n=50000):
    """Extract complex, academic vocabulary from a corpus."""
    print("Tokenizing corpus...")
    words = word_tokenize(text_corpus.lower())
    
    print("Filtering stopwords and short words...")
    stop_words = set(stopwords.words('english'))
    # Filter for words that are purely alphabetic, not stopwords, and at least 6 characters long (filters out basic words)
    academic_words = [
        w for w in words 
        if w.isalpha() and w not in stop_words and len(w) >= 6
    ]
    
    print("Counting frequencies...")
    word_counts = Counter(academic_words)
    
    # We want words that are common enough to be statistically significant, but we exclude the top 100 
    # overly common words that might just be generic (like 'research', 'paper', 'study')
    most_common = word_counts.most_common(top_n + 100)
    
    # Skip the absolute most common 100 words, take the rest
    refined_vocab = [word for word, count in most_common[100:]]
    return refined_vocab

def extract_phrases(text_corpus, min_freq=5):
    """Extract common 4-5 word transition phrases."""
    print("Extracting n-grams...")
    # Basic regex to find sentence starters (capitalized words followed by lower case)
    sentences = re.split(r'(?<=[.!?]) +', text_corpus)
    phrases = []
    
    for sentence in sentences:
        words = sentence.split()
        if len(words) >= 4:
            # Take the first 3-5 words of the sentence
            starter = " ".join(words[:4]).strip(",:;")
            if starter[0].isupper():
                phrases.append(starter)
                
    phrase_counts = Counter(phrases)
    return [phrase for phrase, count in phrase_counts.most_common(500) if count >= min_freq]

def main():
    parser = argparse.ArgumentParser(description="Mine Q1 Research Papers for Vocabulary")
    parser.add_argument('--input-dir', required=True, help="Directory containing .txt papers")
    parser.add_argument('--output', default='../data/q1_vocabulary.json', help="Output JSON file")
    args = parser.parse_args()

    corpus = ""
    files = [f for f in os.listdir(args.input_dir) if f.endswith('.txt')]
    print(f"Found {len(files)} files to process.")
    
    for i, file in enumerate(files):
        if i % 100 == 0:
            print(f"Processed {i}/{len(files)} files...")
        filepath = os.path.join(args.input_dir, file)
        corpus += process_file(filepath) + " "

    print(f"Corpus size: {len(corpus)} characters.")
    
    vocab = extract_vocabulary(corpus)
    phrases = extract_phrases(corpus)
    
    output_data = {
        "vocabulary": vocab,
        "phrases": phrases
    }
    
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2)
        
    print(f"Successfully saved {len(vocab)} words and {len(phrases)} phrases to {args.output}")

if __name__ == "__main__":
    main()
