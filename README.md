To make the Kids' Maths Dashboard work, you need to create five "Helper" entities in Home Assistant. These act as the "brain" and "memory" for the card, allowing it to store the API key, track progress, and save the child's token balance.

Here is the list of helpers you need to create and the reason why each one is necessary:

1. OpenAI API Key
Type: input_text

Name: Kids Maths OpenAI Key

Entity ID: input_text.kids_maths_openai_key

Why it's needed: This is the most critical helper. It allows the dashboard to "talk" to the AI. By putting your key here instead of in the code, you keep your account secure. The card reads this key every time it needs to generate a new question or a chat response.

2. Token Balance
Type: input_text (or input_number)

Name: Kids Maths Token Balance

Entity ID: input_text.kids_maths_token_balance

Why it's needed: This acts as your child's "Bank Account." When they get a question right, the code increases this number. When they buy something from the Shop, the code decreases it. Because it's a Home Assistant helper, the "money" won't disappear even if they switch tablets or clear their browser cache.

3. Internet Access Toggle
Type: input_boolean

Name: Kids Maths Internet

Entity ID: input_boolean.kids_maths_internet

Why it's needed: This is the "Reward Switch." Many parents use this to automate their home's internet or TV access. The dashboard is designed to turn this switch ON automatically when the "Daily Mandatory Question" is completed, serving as a gateway to their screen time.

4. Weak Topics Tracker
Type: input_text

Name: Kids Maths Weak Topics

Entity ID: input_text.kids_maths_weak_topics

Why it's needed: This is the "Learning Memory." Every time your child gets a question wrong, the card records the topic (e.g., "Fractions"). Over time, this helper builds a list of what they struggle with, and the AI uses this data to generate more practice questions for those specific areas.

5. Question Cache
Type: input_text

Name: Kids Maths Question Cache

Entity ID: input_text.kids_maths_question_cache

Why it's needed: This prevents the card from "forgetting" the questions for the day. It stores the date and the current set of generated questions. Without this, the child would get a brand-new set of questions every time they refreshed the page, which would make it too easy to skip hard problems.


