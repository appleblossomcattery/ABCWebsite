/**
 * Apple Blossom Cattery — service-area pages.
 *
 * WHY THESE EXIST
 * Competitors rank for "cattery <town>" by publishing a page written about that
 * town. Catnappery, at Efail Isaf, titles a page "Luxury Cattery In Cowbridge"
 * and outranks us for "cattery cowbridge" on ~350 words in which the word
 * "Cowbridge" appears twice, in the title and the H1, and nothing else on the
 * page is about Cowbridge at all. Organic results are ranked on what a page
 * says, not on where the business stands — only the map pack needs a real
 * address — so the answer is to publish better pages for the same towns.
 *
 * "Better" is doing the work, not the trick. Near-identical pages spun per town
 * are doorway pages, and Google demotes them; each page below carries its own
 * route, its own villages, its own reason and its own numbers.
 *
 * THE NUMBERS ARE REAL. `households` is the count of customers in the booking
 * system whose postcode falls in that area's CF districts (16 Sep 2026), and
 * `active` is those with a stay ending in the last 24 months. They decide which
 * towns get a page: Caerphilly is deliberately absent — Catnappery targets it,
 * we have five households there, and a page claiming otherwise would be untrue.
 * The Rhondda and Cynon valleys, by contrast, are the second most active area
 * on the book (65 households in two years) and had no page anywhere.
 *
 * To re-check the figures, group customers by postcode district and left-join
 * bookings on cust_id where end_at is within 24 months.
 *
 * DISTANCES are computed from the published coordinates (51.505458, -3.409968)
 * and rounded out to a road-ish figure, so they are approximate by design —
 * every one is written "about". Correct any you know better.
 *
 * PICK-UP: the booking system records 12 transport bookings and no mileage at
 * all, so no page here states a collection radius. They link to /pickup/ and
 * say to ask, which is what that page already says.
 */

// Shared, already-published facts. Kept in ONE place so a change (a new review
// count, a new licence number) cannot leave seven pages disagreeing.
const FACTS = {
  phone: '07855 475851',
  phoneHref: '07855475851',
  email: 'enquiries@appleblossomcattery.com',
  address: 'Cowbridge Road, Talygarn, Pontyclun CF72 9JU',
  rating: '4.9',
  reviews: '71',
  yellVotes: '60',
  licence: 'BOE028',
};

const AREAS = [
  {
    slug: 'cat-boarding-cowbridge',
    name: 'Cowbridge',
    region: 'Cowbridge & the Vale villages',
    title: 'Cat Boarding near Cowbridge - Apple Blossom Cattery',
    description:
      'Licensed, climate-controlled cat boarding about five miles from Cowbridge; we are on Cowbridge Road itself. More than 110 Cowbridge and Vale households board with us. Rated 4.9★ from 71 Google reviews.',
    h1: 'Cat Boarding near Cowbridge',
    households: 115,
    standfirst:
      'We are not in Cowbridge. We are about five miles up the road from it, and the road outside our gate is called Cowbridge Road. We think that is worth saying plainly, because a cattery that tells you it is in your town when it is not has already told you something about how carefully it handles the truth.',
    journey: [
      'From Cowbridge the drive is a straight one: out past Aberthin and Ystradowen on the A4222, then the lane north to Talygarn. It is about five miles and, traffic being what it is in the Vale, usually ten to fifteen minutes. There is no town centre to cross, no multi-storey, and nowhere on the route where you will sit in a queue with a yowling carrier on the back seat.',
      'That short, quiet journey is the thing Cowbridge owners tell us they value most. A cat that arrives calm settles faster, eats sooner and goes home in better shape than a cat that has spent forty minutes in stop-start traffic.',
    ],
    places: [
      'Cowbridge', 'Llanblethian', 'Aberthin', 'Ystradowen', 'Penllyn', 'Colwinston',
      'Llansannor', 'St Hilary', 'Pentre Meyrick', 'Cross Inn', 'Llanharry', 'Peterston-super-Ely',
    ],
    angle: {
      h2: 'Why Cowbridge owners come up the road to us',
      paras: [
        'Since we opened in 2019, more than 110 households with Cowbridge and Vale village postcodes have boarded their cats here. Most found us the way people in the Vale find anything: someone they know had used us, and said so.',
        'The cattery was purpose-built, not converted. Every pen is climate-controlled, with full-length sneeze barriers between neighbours and a metre-wide safety corridor running the length of the building. The pens are constructed so cats can scent the fresh air whilst remaining secure indoors. Our walk-in singles run from 2.6 to 3.5 m², doubles give 4.58 m², family pens 6.37 m², and three pairs of doubles can open into 9.16 m² suites for households that board several cats together.',
        'Come and see it before you book. We would rather you did than took a webpage\'s word for it.',
      ],
    },
  },

  {
    slug: 'cat-boarding-bridgend',
    name: 'Bridgend',
    region: 'Bridgend, Pencoed & Porthcawl',
    title: 'Cat Boarding near Bridgend & Pencoed - Apple Blossom Cattery',
    description:
      'Climate-controlled, licensed cat boarding about ten miles from Bridgend, one junction along the M4. Nearly 200 Bridgend-area households board with us. Rated 4.9★ from 71 Google reviews.',
    h1: 'Cat Boarding near Bridgend',
    households: 196,
    standfirst:
      'Bridgend is the biggest group of customers we have outside our own villages: nearly two hundred households across Bridgend, Brackla, Pencoed, Sarn and the Porthcawl side. It is about ten miles and one motorway junction away.',
    journey: [
      'From Bridgend it is the M4 eastbound, off at Junction 34 (Miskin), and a couple of minutes of lane to Talygarn: roughly ten miles, about twenty minutes. From Pencoed it is shorter still: the A473 runs almost to our door, and most Pencoed owners are with us inside a quarter of an hour.',
      'Coming from Porthcawl, Pyle or Kenfig Hill, the M4 from Junction 37 makes it about a half-hour run, which is why we still see a steady stream of cats from the coast.',
    ],
    places: [
      'Bridgend', 'Brackla', 'Pencoed', 'Sarn', 'Coity', 'Litchard', 'Aberkenfig',
      'Porthcawl', 'Pyle', 'Kenfig Hill', 'Maesteg', 'Llanharan',
    ],
    angle: {
      h2: 'What a twenty-minute drive buys you',
      paras: [
        'There are catteries closer to Bridgend town than we are. Nearly two hundred Bridgend-area households drive past them to get to us.',
        'What they are driving to is a purpose-built, fully climate-controlled cattery in open countryside: warm in February, genuinely cool in August, with external storm guards that keep the pens dry in bad weather and come off on fine days so the building fills with fresh air and the sounds of the fields. Every pen looks out over that view.',
        'We are licensed and inspected by the Vale of Glamorgan Animal Welfare team (Animal Boarding Licence no. BOE028), fully insured, and members of the Pet Industry Federation. Our full policies and procedures, covering how every cat is booked in, fed, medicated and watched over, are published in full on this site, which is not something most catteries will do.',
      ],
    },
  },

  {
    slug: 'cat-boarding-cardiff',
    name: 'Cardiff',
    region: 'Cardiff & the western suburbs',
    title: 'Cat Boarding near Cardiff - Apple Blossom Cattery, Vale of Glamorgan',
    description:
      'Country cat boarding about twenty-five minutes from Cardiff, just off M4 Junction 34. Climate-controlled, licensed, 4.9★ from 71 Google reviews. Over 100 Cardiff households board with us.',
    h1: 'Cat Boarding near Cardiff',
    households: 108,
    standfirst:
      'We are about thirteen miles west of Cardiff, immediately off Junction 34 of the M4, the first junction past the city. For most of west and north Cardiff that is a twenty-five minute drive into open countryside, and the last two minutes of it are down a lane.',
    journey: [
      'From Llandaff, Radyr, Fairwater, Ely or Pentyrch, the A4119 or the M4 both bring you to Junction 34 in about twenty minutes. From Canton, Cathays, Roath and the centre, allow twenty-five to thirty. From Rumney, St Mellons and Llanrumney on the eastern side, the M4 makes it a straightforward half-hour.',
      'Because we sit right beside Junction 34, the run works particularly well around a flight. Cardiff Airport is about ten miles from us down the A48 and Five Mile Lane, so dropping your cat off and carrying on to the airport does not mean crossing the city twice.',
    ],
    places: [
      'Llandaff', 'Radyr', 'Creigiau', 'Pentyrch', 'Fairwater', 'Ely', 'Canton',
      'Whitchurch', 'Rhiwbina', 'Cathays', 'Roath', 'St Mellons', 'Taffs Well',
    ],
    angle: {
      h2: 'A city cat in the countryside',
      paras: [
        'More than a hundred Cardiff households board with us, and the reason they give is nearly always the same: they wanted their cat out of the city for the fortnight, not parked in it.',
        'Every pen here is climate-controlled and looks out over fields. On fine days the external storm guards come off and the cattery fills with fresh air, birdsong and the smell of the countryside, so a cat gets the interest of the outdoors without taking its chances.',
        'We charge per pen per day, from £17 a day for one cat, with no themed-room tiers and no hidden extras. Two cats from the same household share a pen at a shared rate rather than paying twice.',
      ],
    },
  },

  {
    slug: 'cat-boarding-pontypridd',
    name: 'Pontypridd',
    region: 'Pontypridd, Church Village & Efail Isaf',
    title: 'Cat Boarding near Pontypridd & Church Village - Apple Blossom Cattery',
    description:
      'Licensed, climate-controlled cat boarding about twenty minutes from Pontypridd on the A473. More than 70 Pontypridd-area households board with us. Rated 4.9★ from 71 Google reviews.',
    h1: 'Cat Boarding near Pontypridd',
    households: 73,
    standfirst:
      'More than seventy households from Pontypridd, Church Village, Efail Isaf, Beddau and Tonteg board their cats with us. The A473 runs from Pontypridd almost to our gate: about nine miles, and usually twenty minutes.',
    journey: [
      'From Pontypridd take the A473 west through Llantwit Fardre and Beddau, past Talbot Green, and we are signposted off the lane at Talygarn. From Church Village or Efail Isaf it is shorter: six or seven miles, nearer a quarter of an hour.',
      'It is a route without a single town centre on it, which is the point: the cat travels through countryside rather than traffic.',
    ],
    places: [
      'Pontypridd', 'Church Village', 'Efail Isaf', 'Beddau', 'Tonteg', 'Llantwit Fardre',
      'Rhydyfelin', 'Treforest', 'Hawthorn', 'Glyncoch', 'Cilfynydd',
    ],
    angle: {
      h2: 'You have a choice locally, so compare us properly',
      paras: [
        'There is more than one cattery within reach of Pontypridd, and we would always rather you looked at several and chose well than took anyone\'s word for it, ours included.',
        'So here is what we would ask you to compare. Is the building purpose-built and climate-controlled, or converted? Is there a full-length sneeze barrier between each pen and its neighbours, and a safety corridor? Are the pens constructed so a cat can scent the fresh air whilst remaining secure indoors? Can you read the cattery\'s policies and procedures before you book? Ours are published in full on this site. Who holds the licence, and what is its number? Ours is BOE028, issued by the Vale of Glamorgan.',
        'Then come and see it for yourself before you decide.',
      ],
    },
  },

  {
    slug: 'cat-boarding-rhondda',
    name: 'the Rhondda & Cynon valleys',
    region: 'Rhondda, Tonyrefail, Aberdare & Mountain Ash',
    title: 'Cat Boarding for the Rhondda & Cynon Valleys - Apple Blossom Cattery',
    description:
      'Licensed, climate-controlled cat boarding at the foot of the Rhondda, straight down the A4119. Around 160 valley households board with us, our second busiest area. 4.9★ from 71 Google reviews.',
    h1: 'Cat Boarding for the Rhondda & Cynon Valleys',
    households: 159,
    standfirst:
      'Around a hundred and sixty valley households board their cats with us. After our own villages, the Rhondda and Cynon are the busiest part of our book. The A4119 comes down the valley and lands you at our door.',
    journey: [
      'From Tonyrefail or Porth the A4119 brings you to Talbot Green in about fifteen minutes, and we are a couple of miles further on. From Tonypandy allow around twenty-five minutes, from Treorchy and Ton Pentre nearer thirty-five, and from Mountain Ash or Aberdare about the same by the A4059 and A4119.',
      'It is one road most of the way, which matters with a cat in the car: no junction-hopping, no town centres, and the last stretch is open countryside.',
    ],
    places: [
      'Porth', 'Tonypandy', 'Treorchy', 'Ton Pentre', 'Treherbert', 'Ferndale',
      'Tylorstown', 'Tonyrefail', 'Mountain Ash', 'Aberdare', 'Hirwaun', 'Pentre',
    ],
    angle: {
      h2: 'The valleys are not an afterthought here',
      paras: [
        'Plenty of catteries in this corner of south Wales write their pages for Cardiff and Cowbridge and never mention the valleys at all. We think that is a strange way to run one: sixty-five valley households have boarded with us in the last two years alone.',
        'Everything we offer is the same whichever direction you come from: climate-controlled, purpose-built pens with field views, per-pen pricing from £17 a day, medication given at no extra charge where we can safely give it, and a licensed, insured, inspected cattery behind it.',
        'If the drive down is the thing putting you off, ask about pick-up and drop-off when you enquire. We can often collect and return, depending on the day and how far it is.',
      ],
    },
  },

  {
    slug: 'cat-boarding-barry',
    name: 'Barry',
    region: 'Barry, Penarth & Llantwit Major',
    title: 'Cat Boarding near Barry, Penarth & Llantwit Major - Apple Blossom Cattery',
    description:
      'Climate-controlled, licensed cat boarding about twenty-five minutes from Barry, and ten miles from Cardiff Airport. Rated 4.9★ from 71 Google reviews.',
    h1: 'Cat Boarding near Barry & the Vale coast',
    households: 61,
    standfirst:
      'Barry, Penarth, Dinas Powys and Llantwit Major are about twenty-five minutes away across the Vale. Usefully for a coast that flies a lot, we are only about ten miles from Cardiff Airport.',
    journey: [
      'From Barry the quickest run is Five Mile Lane (A4226) to the A48, west to Cowbridge and then north up Cowbridge Road to Talygarn: about twelve miles, twenty-five minutes. From Penarth and Dinas Powys, the A4232 and M4 do the same job in a similar time. From Llantwit Major it is the B4265 and A48.',
      'For anyone flying, the cattery is on the way: drop your cat off, and the terminal is another twenty minutes down the road.',
    ],
    places: [
      'Barry', 'Barry Island', 'Penarth', 'Dinas Powys', 'Sully', 'Rhoose',
      'Llantwit Major', 'St Athan', 'Wenvoe', 'Cadoxton', 'Cardiff Airport',
    ],
    angle: {
      h2: 'Holidays, flights and long stays',
      paras: [
        'A good share of our Vale coast bookings are built around flights, and long stays are ordinary here. Cats who are with us for two or three weeks get the same routine every day, and their owners get an update and photographs while they are away.',
        'If your cat needs medication, say so when you book: tablets, liquids, topicals and, in most cases, injections are given at no extra charge, and we will confirm anything unusual with your own vet before the stay.',
        'Vaccinations are checked on arrival, every time, without exception; our accepted-product chart is published on this site so you can check your cat\'s card against it before you set off.',
      ],
    },
  },

  {
    slug: 'cat-boarding-llantrisant',
    name: 'Llantrisant & Talbot Green',
    region: 'Pontyclun, Llantrisant, Talbot Green & Miskin',
    title: 'Cat Boarding in Pontyclun, Llantrisant & Talbot Green - Apple Blossom Cattery',
    description:
      'Your local cattery: purpose-built, climate-controlled cat boarding minutes from Llantrisant, Talbot Green and Pontyclun. Over 300 local households board with us. 4.9★ from 71 Google reviews.',
    h1: 'Cat Boarding in Pontyclun, Llantrisant & Talbot Green',
    households: 312,
    standfirst:
      'This is home. We are at Talygarn, two or three miles from Llantrisant and Talbot Green and a few minutes from Pontyclun, and more than three hundred households from these villages have boarded their cats with us since 2019.',
    journey: [
      'From Talbot Green or Llantrisant it is the A473 west and then the lane at Talygarn: two to three miles, five to ten minutes. From Pontyclun, Brynsadler or Miskin you are here almost immediately, and from Llanharry and Llanharan it is a five-minute run.',
      'Being this close has a practical benefit people do not always think of: a short journey is a small ask of a nervous cat, and it makes an unplanned extra day or an early collection easy to arrange.',
    ],
    places: [
      'Pontyclun', 'Llantrisant', 'Talbot Green', 'Miskin', 'Llanharry', 'Llanharan',
      'Brynsadler', 'Groesfaen', 'Cross Inn', 'Talygarn', 'Ynysddu', 'Bryncae',
    ],
    angle: {
      h2: 'The cattery your neighbours use',
      paras: [
        'A third of everyone on our books lives within a few miles of the cattery. In a village you only get that through word of mouth, and you would lose it just as fast if you let people down.',
        'We are licensed and inspected by the Vale of Glamorgan Animal Welfare team (Animal Boarding Licence no. BOE028), fully insured, and members of the Pet Industry Federation. Rated 4.9 out of 5 from 71 Google reviews and 5 out of 5 from 60 reviews on Yell.',
        'If you have not been up before, come and look round; most of our neighbours did exactly that before their first booking.',
      ],
    },
  },
];

module.exports = { AREAS, FACTS };
