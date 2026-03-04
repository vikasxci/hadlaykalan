require('dotenv').config();
const mongoose = require('mongoose');
const Slider = require('./models/Slider');
const Notice = require('./models/Notice');
const { MandiRate, FarmerTip } = require('./models/Farmer');
const VillageInfo = require('./models/VillageInfo');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Dummy Data
const sliders = [
  {
    image: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800',
    title: 'Welcome to Hadlay Kalan',
    description: 'A progressive village with rich heritage and modern facilities',
    type: 'news',
    order: 1
  },
  {
    image: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800',
    title: 'Annual Village Fair 2026',
    description: 'Join us for the biggest celebration of the year on 15th March',
    type: 'event',
    order: 2
  },
  {
    image: 'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800',
    title: 'New Community Center Opened',
    description: 'State-of-the-art facility for village meetings and events',
    type: 'news',
    order: 3
  },
  {
    image: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=800',
    title: 'Agricultural Training Program',
    description: 'Free training for farmers on modern farming techniques',
    type: 'ad',
    order: 4
  },
  {
    image: 'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=800',
    title: 'Clean Village Initiative',
    description: 'Together we make our village cleaner and greener',
    type: 'news',
    order: 5
  },
  {
    image: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800',
    title: 'Sports Tournament 2026',
    description: 'Inter-village cricket and kabaddi matches starting soon',
    type: 'event',
    order: 6
  },
  {
    image: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800',
    title: 'New School Building',
    description: 'Modern education facility with digital classrooms',
    type: 'news',
    order: 7
  },
  {
    image: 'https://images.unsplash.com/photo-1416339442236-8ceb164046f8?w=800',
    title: 'Organic Farming Subsidy',
    description: 'Government support for organic farming practices',
    type: 'ad',
    order: 8
  },
  {
    image: 'https://images.unsplash.com/photo-1605000797499-95a51c5269ae?w=800',
    title: 'Village Health Camp',
    description: 'Free medical checkup on 10th March at Community Center',
    type: 'event',
    order: 9
  },
  {
    image: 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=800',
    title: 'Youth Development Program',
    description: 'Skill development and career guidance for village youth',
    type: 'ad',
    order: 10
  }
];

const notices = [
  {
    title: 'Water Supply Timing Change',
    content: 'Dear Residents, Please note that water supply timings have been changed. Morning supply: 6 AM - 8 AM, Evening supply: 6 PM - 8 PM. Please cooperate and use water judiciously.',
    category: 'general',
    postedBy: 'Water Committee',
    isPinned: true
  },
  {
    title: 'Village Panchayat Meeting',
    content: 'A village panchayat meeting will be held on 8th March 2026 at 4 PM in the Community Center. All residents are requested to attend. Important decisions regarding village development will be discussed.',
    category: 'meeting',
    postedBy: 'Sarpanch Office',
    eventDate: new Date('2026-03-08'),
    isPinned: true
  },
  {
    title: 'School Admission Notice',
    content: 'Admissions open for classes 1-10 for academic year 2026-27. Last date to apply: 20th March 2026. Contact school office for forms and details.',
    category: 'announcement',
    postedBy: 'Village School',
    eventDate: new Date('2026-03-20')
  },
  {
    title: 'Street Light Maintenance',
    content: 'Street light maintenance work will be carried out from 5th to 7th March. Some areas may experience temporary disruption. Inconvenience is regretted.',
    category: 'general',
    postedBy: 'Electricity Department'
  },
  {
    title: 'Vaccination Drive for Cattle',
    content: 'Free vaccination drive for cattle will be organized on 12th March at the Veterinary Center. All cattle owners are requested to bring their animals.',
    category: 'announcement',
    postedBy: 'Veterinary Department',
    eventDate: new Date('2026-03-12')
  },
  {
    title: 'Women Self-Help Group Meeting',
    content: 'Monthly meeting of Women Self-Help Groups will be held on 15th March at 3 PM. Discussion on new handicraft projects and loan facilities.',
    category: 'event',
    postedBy: 'SHG Committee',
    eventDate: new Date('2026-03-15')
  },
  {
    title: 'Road Construction Update',
    content: 'The construction of the main road from village to highway is 60% complete. Expected completion by May 2026. Alternative routes are available for heavy vehicles.',
    category: 'general',
    postedBy: 'PWD Office'
  },
  {
    title: 'Ration Distribution Schedule',
    content: 'PDS ration distribution for March 2026: Card Series 1-50 on 5th March, Series 51-100 on 6th March, Series 101+ on 7th March. Timings: 10 AM to 4 PM.',
    category: 'announcement',
    postedBy: 'Ration Shop',
    isPinned: true
  },
  {
    title: 'Cleanliness Drive',
    content: 'Village-wide cleanliness drive on 14th March from 7 AM onwards. All residents are encouraged to participate. Cleaning materials will be provided.',
    category: 'event',
    postedBy: 'Cleanliness Committee',
    eventDate: new Date('2026-03-14')
  },
  {
    title: 'Internet Connectivity Project',
    content: 'Good news! High-speed internet connectivity project approved for our village. Installation to begin in April 2026. Every household will get affordable internet access.',
    category: 'announcement',
    postedBy: 'Sarpanch Office'
  }
];

// NOTE: Contacts are managed directly in DB and intentionally NOT seeded here.


const mandiRates = [
  // पोलाय कलां मंडी
  { crop: 'गेहूं', market: 'पोलाय कलां', price: 2275, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'चना', market: 'पोलाय कलां', price: 5100, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'सोयाबीन', market: 'पोलाय कलां', price: 4350, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'मसूर', market: 'पोलाय कलां', price: 5600, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  // शुजालपुर मंडी
  { crop: 'गेहूं', market: 'शुजालपुर', price: 2300, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'चना', market: 'शुजालपुर', price: 5200, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'सोयाबीन', market: 'शुजालपुर', price: 4400, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'मसूर', market: 'शुजालपुर', price: 5700, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'टमाटर', market: 'शुजालपुर', price: 1200, unit: 'प्रति क्विंटल', trend: 'down', date: new Date() },
  // अकोदिया मंडी
  { crop: 'गेहूं', market: 'अकोदिया', price: 2250, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'चना', market: 'अकोदिया', price: 5050, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'सोयाबीन', market: 'अकोदिया', price: 4300, unit: 'प्रति क्विंटल', trend: 'down', date: new Date() },
  { crop: 'प्याज', market: 'अकोदिया', price: 1800, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  // कालापीपल मंडी
  { crop: 'गेहूं', market: 'कालापीपल', price: 2280, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'चना', market: 'कालापीपल', price: 5150, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'सोयाबीन', market: 'कालापीपल', price: 4380, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'मसूर', market: 'कालापीपल', price: 5650, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'लहसुन', market: 'कालापीपल', price: 8500, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  // आष्टा मंडी
  { crop: 'गेहूं', market: 'आष्टा', price: 2290, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'चना', market: 'आष्टा', price: 5180, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'सोयाबीन', market: 'आष्टा', price: 4420, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'टमाटर', market: 'आष्टा', price: 1150, unit: 'प्रति क्विंटल', trend: 'down', date: new Date() },
  { crop: 'मक्का', market: 'आष्टा', price: 1950, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  // इंदौर मंडी
  { crop: 'गेहूं', market: 'इंदौर', price: 2350, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'चना', market: 'इंदौर', price: 5300, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'सोयाबीन', market: 'इंदौर', price: 4500, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'मसूर', market: 'इंदौर', price: 5800, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
  { crop: 'टमाटर', market: 'इंदौर', price: 1100, unit: 'प्रति क्विंटल', trend: 'down', date: new Date() },
  { crop: 'प्याज', market: 'इंदौर', price: 1900, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'लहसुन', market: 'इंदौर', price: 9000, unit: 'प्रति क्विंटल', trend: 'up', date: new Date() },
  { crop: 'मक्का', market: 'इंदौर', price: 2000, unit: 'प्रति क्विंटल', trend: 'stable', date: new Date() },
];

const farmerTips = [
  {
    title: 'गेहूं की कटाई के बेहतरीन सुझाव',
    content: 'गेहूं की कटाई तब करें जब दानों में 20-25% नमी हो। देर से कटाई करने पर दाने झड़ सकते हैं और गुणवत्ता कम होती है। तेज धार वाले हंसिये या हार्वेस्टर का उपयोग करें। सुबह की ठंडक में कटाई करना बेहतर रहता है।',
    category: 'crop'
  },
  {
    title: 'सोयाबीन की बुवाई कैसे करें',
    content: 'सोयाबीन की बुवाई जून-जुलाई में मानसून की पहली बारिश के बाद करें। बीज दर 70-80 किलो प्रति हेक्टेयर रखें। कतार से कतार की दूरी 30-45 सेमी और पौधे से पौधे की दूरी 5-7 सेमी रखें। बीज उपचार थायरम या कार्बेंडाजिम से जरूर करें।',
    category: 'crop'
  },
  {
    title: 'चना की खेती में सावधानियां',
    content: 'चना की बुवाई अक्टूबर-नवंबर में करें। उकठा (विल्ट) रोग से बचाव के लिए रोग प्रतिरोधी किस्में जैसे JG-63, JG-130 लगाएं। अधिक सिंचाई से बचें क्योंकि इससे जड़ सड़न की समस्या होती है। फूल आने पर हल्की सिंचाई लाभदायक है।',
    category: 'crop'
  },
  {
    title: 'जैविक खाद (कम्पोस्ट) कैसे बनाएं',
    content: 'गोबर, फसल अवशेष और रसोई का कचरा मिलाकर गड्ढे में डालें। हर 15 दिन में पलटें और नमी बनाए रखें। 3-4 महीने में उत्तम जैविक खाद तैयार होगी। यह मिट्टी की उर्वरता बढ़ाती है और रासायनिक खाद का खर्च बचाती है।',
    category: 'tips'
  },
  {
    title: 'प्रधानमंत्री किसान सम्मान निधि योजना',
    content: 'इस योजना में किसानों को सालाना ₹6,000 तीन किस्तों में मिलते हैं। आवेदन के लिए आधार कार्ड, बैंक पासबुक और जमीन के कागजात साथ लेकर नजदीकी CSC सेंटर या कृषि विभाग कार्यालय जाएं। ऑनलाइन भी pmkisan.gov.in पर आवेदन कर सकते हैं।',
    category: 'scheme'
  },
  {
    title: 'बारिश के मौसम में फसल सुरक्षा',
    content: 'अधिक बारिश में खेत में जल निकासी (ड्रेनेज) की व्यवस्था करें। फसल पर फफूंदनाशक का छिड़काव करें। मेड़बंदी मजबूत रखें ताकि पानी खेत में ना भरे। सोयाबीन और कपास की फसल में विशेष ध्यान दें।',
    category: 'weather'
  },
  {
    title: 'ड्रिप सिंचाई पर सरकारी सब्सिडी',
    content: 'ड्रिप सिंचाई से 50% तक पानी की बचत होती है और फसल की पैदावार भी बढ़ती है। सरकार 55-85% तक सब्सिडी देती है। आवेदन के लिए जिला कृषि अधिकारी कार्यालय से संपर्क करें। छोटे और सीमांत किसानों को अधिक सब्सिडी मिलती है।',
    category: 'scheme'
  },
  {
    title: 'कीट नियंत्रण के देसी उपाय',
    content: 'नीम के तेल (5 मिली/लीटर) का छिड़काव कीटों से बचाता है। पीले चिपचिपे ट्रैप (Yellow Sticky Trap) से सफेद मक्खी पकड़ें। हल्दी और लहसुन का घोल भी कीट भगाने में कारगर है। रासायनिक दवाइयों का अंधाधुंध इस्तेमाल ना करें।',
    category: 'tips'
  },
  {
    title: 'मंडी में अच्छी कीमत कैसे पाएं',
    content: 'फसल को साफ करके और ग्रेडिंग करके बेचें। नमी का स्तर सही रखें (गेहूं में 12%, सोयाबीन में 10%)। एक साथ बड़ी मात्रा में बेचने से बेहतर भाव मिलता है। e-NAM पोर्टल पर रजिस्टर करें और ऑनलाइन मंडी में भी बेच सकते हैं।',
    category: 'market'
  },
  {
    title: 'मसूर दाल की खेती के टिप्स',
    content: 'मसूर की बुवाई अक्टूबर के अंत से नवंबर की शुरुआत में करें। बीज दर 30-40 किलो प्रति हेक्टेयर। हल्की दोमट मिट्टी सबसे उपयुक्त है। फसल में एक या दो सिंचाई पर्याप्त होती है। उकठा रोग से बचाव के लिए बीज उपचार जरूरी है।',
    category: 'crop'
  },
  {
    title: 'टमाटर की खेती में ध्यान रखने वाली बातें',
    content: 'टमाटर की नर्सरी में पौध तैयार करें और 25-30 दिन बाद रोपाई करें। पौधे की दूरी 60x45 सेमी रखें। स्टेकिंग (सहारा देना) जरूरी है। फल छेदक कीट से बचाव के लिए फेरोमोन ट्रैप लगाएं। अच्छी पैदावार के लिए जैविक खाद और वर्मी कम्पोस्ट डालें।',
    category: 'crop'
  },
  {
    title: 'फसल बीमा योजना (PMFBY)',
    content: 'प्रधानमंत्री फसल बीमा योजना के तहत प्राकृतिक आपदा से फसल नुकसान होने पर मुआवजा मिलता है। खरीफ फसल के लिए 2% और रबी फसल के लिए 1.5% प्रीमियम देना होता है। बुवाई के 10 दिन के भीतर बैंक या CSC सेंटर से आवेदन करें।',
    category: 'scheme'
  }
];

const villageInfo = [
  { key: 'population', value: '3,500+' },
  { key: 'area', value: '1,200 एकड़' },
  { key: 'households', value: '650+' },
  { key: 'schools', value: '2 (प्राथमिक एवं माध्यमिक)' },
  { key: 'hospitals', value: '1 उप-स्वास्थ्य केंद्र' },
  { key: 'temples', value: '4' },
  { key: 'masjid', value: '1' },
  { key: 'banks', value: '1 शाखा' },
  { key: 'post_office', value: '1' },
  { key: 'pin_code', value: '465333' },
  { key: 'district', value: 'शाजापुर, मध्य प्रदेश' },
  { key: 'tehsil', value: 'शुजालपुर' }
];

// Seed function
async function seedDatabase() {
  try {
    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('Clearing existing data...');
    await Slider.deleteMany({});
    await Notice.deleteMany({});
    await MandiRate.deleteMany({});
    await FarmerTip.deleteMany({});
    await VillageInfo.deleteMany({});

    // Insert new data
    console.log('Inserting sliders...');
    await Slider.insertMany(sliders);
    
    console.log('Inserting notices...');
    await Notice.insertMany(notices);
    
    console.log('Inserting mandi rates...');
    await MandiRate.insertMany(mandiRates);
    
    console.log('Inserting farmer tips...');
    await FarmerTip.insertMany(farmerTips);
    
    console.log('Inserting village info...');
    await VillageInfo.insertMany(villageInfo);

    console.log('\n✅ Database seeded successfully!');
    console.log('📊 Summary:');
    console.log(`   - ${sliders.length} Sliders`);
    console.log(`   - ${notices.length} Notices`);
    console.log(`   - ${mandiRates.length} Mandi Rates`);
    console.log(`   - ${farmerTips.length} Farmer Tips`);
    console.log(`   - ${villageInfo.length} Village Info Items`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

// Run the seed function
seedDatabase();
