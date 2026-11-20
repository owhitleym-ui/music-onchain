// Artist photos from Unsplash (https://unsplash.com/license), hotlinked and credited as the
// Unsplash API guidelines require. Generated once by a local helper; edit by hand if needed.
// Fictional artists use stock photos of real people for demo purposes only.
const sized = (url, w, h) => `${url}&w=${w}&h=${h}&fit=crop&crop=faces,entropy&q=72&auto=format`;

export const PHOTO_CREDITS = Object.freeze({
  "megan-moroney": {
    "url": "https://images.unsplash.com/photo-1633618110285-6a62fa182fc5?ixlib=rb-4.1.0",
    "photographer": "Sean Foster",
    "profile": "https://unsplash.com/@fosterious?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/photos/a-view-of-a-mountain-range-in-the-fall-QAKuBtN3B1o?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "Orange autumn foliage and misty ridges in the Great Smoky Mountains; illustrative Tennessee Orange demo artwork"
  },
  "maroon-5": {
    "url": "https://images.unsplash.com/photo-1724390265362-c58d0bc7d17a?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8Y29uY2VydCUyMHN0YWdlJTIwbGlnaHRzfGVufDF8Mnx8fDE3OTUxNjM0NjJ8MA&ixlib=rb-4.1.0",
    "photographer": "Aditya Sethia",
    "profile": "https://unsplash.com/@aditya_sethia_97?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "A crowd of people standing on top of a stage"
  },
  "maya-lane": {
    "url": "https://images.unsplash.com/photo-1763889553234-e9ba2c53ff28?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8aW5kaWUlMjBzaW5nZXIlMjBndWl0YXIlMjBwb3J0cmFpdHxlbnwxfDJ8fHwxNzk1MTYzNDYzfDA&ixlib=rb-4.1.0",
    "photographer": "Austin",
    "profile": "https://unsplash.com/@austin_7792?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "Woman playing acoustic guitar on stage"
  },
  "june-park": {
    "url": "https://images.unsplash.com/photo-1520872024865-3ff2805d8bb3?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8ciUyNmIlMjBzaW5nZXIlMjBwb3J0cmFpdHxlbnwxfDJ8fHwxNzk1MTYzNDYzfDA&ixlib=rb-4.1.0",
    "photographer": "Vidar Nordli-Mathisen",
    "profile": "https://unsplash.com/@vidarnm?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "closeup photographyo fwoman singing"
  },
  "northline": {
    "url": "https://images.unsplash.com/photo-1695277715416-e225cf09d70c?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8ZGolMjBlbGVjdHJvbmljJTIwbXVzaWN8ZW58MXwyfHx8MTc5NTE2MzQ2NHww&ixlib=rb-4.1.0",
    "photographer": "Garv Chaplot",
    "profile": "https://unsplash.com/@garv_4?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "a man standing in front of a dj set"
  },
  "elio": {
    "url": "https://images.unsplash.com/photo-1720842439237-eb01659b52bf?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8Mnx8cG9wJTIwc2luZ2VyJTIwbWljcm9waG9uZXxlbnwxfDJ8fHwxNzk1MTYzNDY0fDA&ixlib=rb-4.1.0",
    "photographer": "Gabriel Tiveron",
    "profile": "https://unsplash.com/@gabrieltiveron?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "A close up of a microphone with a blurry background"
  },
  "olive-reed": {
    "url": "https://images.unsplash.com/photo-1524650359799-842906ca1c06?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8Zm9sayUyMG11c2ljaWFuJTIwYWNvdXN0aWMlMjBndWl0YXJ8ZW58MXwyfHx8MTc5NTE2MzQ2NXww&ixlib=rb-4.1.0",
    "photographer": "Te NGuyen",
    "profile": "https://unsplash.com/@tenguyen?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "woman carrying brown acoustic guitar"
  },
  "atlas-blue": {
    "url": "https://images.unsplash.com/photo-1542492688-75a823ab9f76?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8aW5kaWUlMjBiYW5kJTIwcmVoZWFyc2FsfGVufDF8Mnx8fDE3OTUxNjM0NjV8MA&ixlib=rb-4.1.0",
    "photographer": "Willis Stout",
    "profile": "https://unsplash.com/@willis_stout?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "band group perform on stage"
  },
  "rae-sol": {
    "url": "https://images.unsplash.com/photo-1505430111830-b998ef798efa?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8Mnx8d29tYW4lMjBzaW5naW5nJTIwbWljcm9waG9uZXxlbnwxfDJ8fHwxNzk1MTYzNDc0fDA&ixlib=rb-4.1.0",
    "photographer": "jesse ramirez",
    "profile": "https://unsplash.com/@jesseskitt11?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "woman wearing black scoop-neck t-shirt person holding black wireless microphone"
  },
  "milo-west": {
    "url": "https://images.unsplash.com/photo-1700420546802-30e0703ed37c?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8c2luZ2VyJTIwc29uZ3dyaXRlciUyMHBpYW5vfGVufDF8Mnx8fDE3OTUxNjM0NjZ8MA&ixlib=rb-4.1.0",
    "photographer": "Misha Kolodkin",
    "profile": "https://unsplash.com/@kolodkinmv?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "a red piano sitting on top of a wooden platform"
  },
  "sora": {
    "url": "https://images.unsplash.com/photo-1574882225022-9e0e447e9662?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8c3ludGhlc2l6ZXIlMjBwcm9kdWNlciUyMHN0dWRpb3xlbnwxfDJ8fHwxNzk1MTYzNDY3fDA&ixlib=rb-4.1.0",
    "photographer": "Martin Engel",
    "profile": "https://unsplash.com/@martinengel?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "black audio mixer"
  },
  "ella-bloom": {
    "url": "https://images.unsplash.com/photo-1578667343229-cb53b38cfbbd?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8d29tYW4lMjBhY291c3RpYyUyMGd1aXRhciUyMG91dGRvb3JzfGVufDF8Mnx8fDE3OTUxNjM0Njd8MA&ixlib=rb-4.1.0",
    "photographer": "Nguyen Thu Hoai",
    "profile": "https://unsplash.com/@thwhoai?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "woman wearing white crew-neck long-sleeved shirt holding brown string guitar while facing her left side near body of water"
  },
  "__feature": {
    "url": "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?ixid=M3wxMTM5MzQwfDB8MXxzZWFyY2h8MXx8Y29uY2VydCUyMGNyb3dkJTIwaGFuZHN8ZW58MXwwfHx8MTc5NTE2MzQ2N3ww&ixlib=rb-4.1.0",
    "photographer": "Nainoa Shizuru",
    "profile": "https://unsplash.com/@nainoa?utm_source=music_onchain_demo&utm_medium=referral",
    "source": "https://unsplash.com/?utm_source=music_onchain_demo&utm_medium=referral",
    "alt": "concert photos"
  }
});

export const ARTIST_IMAGES = Object.freeze(Object.fromEntries(
  Object.entries(PHOTO_CREDITS).filter(([id]) => !id.startsWith('__')).map(([id, p]) => [id, sized(p.url, 640, 640)]),
));

export const FEATURE_IMAGE = PHOTO_CREDITS.__feature ? sized(PHOTO_CREDITS.__feature.url, 1600, 700) : null;
