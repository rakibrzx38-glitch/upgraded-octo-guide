const Telegraf = require('telegraf');
const { Scene } = require('telegraf/scene');

// --- থিস বা পুরো কোডটা কিংবা নাহলে নিচের অংশটা মেইন জায়গা ---

// শুরুর সুযোগে টোকেন বসানো:
const TOKEN = '8869620734:AAG9TRcdZ22XcUbVqKwRDBWxc7_QSUDI4tYে'; // সবার আগে BotFather থেকে টোকেন নিয়ে এখানে বসাবে
const TARGET_NUM = '88001636344261‎'; // টার্গেট বাংলার মোবাইল নম্বর (+880 দিয়ে শুরু করতে হবে)

// বটের নাম সেট করা
const bot = new Telegraf(TOKEN);

// এস বা সিন নাম আছে যাতে ইউজার ক্লিক করে কী করতে হবে সেটা বুঝতে পারে
const welcomeScene = new Scene()
    .state('welcome') 
    .default()
    .on('start', (ctx) => { // বট পেরাফ যতক্ষণ সমস্ত সুবিধা পাঠাবে
        ctx.reply('নামদার! 🇧🇩 \nতোমার বট চালাবো কি না? \n(মালিবুটা: Message Bomb, Call: Voice Call)');
        msgOptions(ctx);
    })
    
    // ইউজার যখন মালিবুটা বটের পিক হবে
    .on('message_bomb', async (ctx) => { 
        const duration = 2000; // ২ সেকেন্ডের মধ্যে কতবার মেসেজ ছুড়ে দিবে (মেল)!
        
        // মেসেজ পাঠানোর লজিক
        for(let i=0; i<10; i++) {
            await bot.telegram.sendMessage(TARGET_NUM, ${i+1}. হেই! একটু নজর দিতে বোবা! 📩);
            // একবারে ১০টা মেসেজ কেউ পেলে নাও
        }
        
        await ctx.reply('দুই সেকেন্ডে ১০টা মেসেজ তুলেছে! 🐝\nবার্তা পাশ করতে ' + TARGET_NUM + ' ক্লিক করুন।');
    })
    
    // ইউজার যখন কল চাইবে
    .on('call_bomb', async (ctx) => {
        const audioPath = './assets/my-voice.mp3'; // এখানে তোমার মেসেজের নাম বসাবে
        
        // যদি অডিও পাশ করে না থাকে, তাহলে এই লাইনটা কাজ করবে
        await bot.telegram.sendMessage(TARGET_NUM, 'হেই! একটু কল পাশ করতে 📞\n(বার্তা পাশ করতে ' + TARGET_NUM + ' ক্লিক করুন)');
        
        // কল বা স্ট্রিমিং শুরু হবে
        bot.telegram.sendVoice(TARGET_NUM, audioPath, { 
            title: 'Bangla Boss', 
            thumbnail: audioPath // রিজার্ভে এটা কাজ করবে
        })
        .on('data', () => console.log('Data Streaming...'));
        
        // কল শেষ হলে দেই বা চাঁদের চেয়ে পিছলে আসবে
        .on('end', () => {
            bot.telegram.sendMessage(TARGET_NUM, 'কল ব্যর্থ! আবার চেষ্টা করা? 🔄');
        });
    })

// মেণু বাটন বানানোর ফাংশন (রিকারিং)
const msgOptions = (ctx) => {
    if(ctx.scene.state === 'welcome') {
        ctx.reply('কিস্তি বসে পাকিস্টান:', {
            inline_keyboard: [
                [{ text: '💬 মেসেজ বসবো (Message)', callback_data: 'msg_bomb' }],
                [{ text: '📞 কল বাসবো (Call)', callback_data: 'call_bomb' }],
                [{ text: '🔄 আবার ' + TARGET_NUM + ' ক্লিক', callback_data: 'repeat' }]
            ]
        });
    }
};

// বট যখন টাচ করবে
bot.startScene(welcomeScene);

// হ্যাণ্ডল সিন বলতে গেলে
bot.startScene(welcomeScene);

// শেষ করা বা রেন্ডার থেকে নামিয়ে আনতে হবে
bot.launch();

//'polling_error' হলে প্রিন্টটা তুলবে
bot.on('polling_error', (err) => {
    console.log(Polling error: ${err});
});

// ফাইল শেষ হলো
console.log('Ready to Rock & Roll! 🇧🇩');

// এটিকেন্ডি কেবল বাজবে
process.send();
