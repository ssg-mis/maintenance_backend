const bcrypt = require('bcryptjs');

const hash = '$2b$12$ATFMaj5m4j6VxqdOAJ37fOkOfyYusvPgb6YSEdclU3BAyc0gJxy6m';

const candidates = [
  'ranu', 'ranu123', 'Ranu123', 'Ranu@123', 'Ranu@1234', 'Ranu1234', 'ranu1234',
  'reena', 'reena123', 'Reena123', 'Reena@123', 'Reena@1234', 'reena1234',
  'chaturvedi', 'chaturvedi123', 'Chaturvedi123', 'Chaturvedi@123',
  'chaturvedi98', 'chaturvedireena98', 'chaturvedireena98@gmail.com',
  'emp202', 'EMP202', 'Emp202',
  '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890',
  'admin', 'admin123', 'Admin123', 'Admin@123',
  'user', 'user123', 'User123', 'User@123',
  'password', 'password123', 'Password123', 'Password@123',
  'welcome', 'welcome123', 'Welcome123', 'Welcome@123',
  'ranu chaturvedi', 'Ranu Chaturvedi', 'ranuchaturvedi',
  'reena chaturvedi', 'Reena Chaturvedi', 'reenachaturvedi',
  'botivate', 'botivate123', 'Botivate123', 'Botivate@123',
  'maintenance', 'maintenance123', 'Maintenance123', 'Maintenance@123',
  'test', 'test1234', 'test123', 'Test123', 'Test@123',
  '333', '9171', '98'
];

async function check() {
  for (const c of candidates) {
    if (await bcrypt.compare(c, hash)) {
      console.log('FOUND MATCHING PASSWORD:', c);
      return;
    }
  }
  console.log('No match in candidate list');
}

check();
