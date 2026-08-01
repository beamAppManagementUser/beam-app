#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');

function generateBcryptHash(password) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hashSync(password, 10);
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n🔐 Beam Veda — Root Admin Password Reset\n');
  console.log('This will update the root admin (Admin) password in D1.\n');
  rl.question('Enter new password (min 6 characters): ', (password) => {
    if (!password || password.length < 6) { console.error('❌ Password must be at least 6 characters.'); rl.close(); process.exit(1); }
    rl.question('Confirm password: ', (confirm) => {
      if (password !== confirm) { console.error('❌ Passwords do not match.'); rl.close(); process.exit(1); }
      const hash = generateBcryptHash(password);
      const escapedHash = hash.replace(/'/g, "''");
      console.log('\nUpdating root admin password in D1...\n');
      try {
        const sql = `UPDATE users SET password_hash = '${escapedHash}', failed_attempts = 0, locked_until = NULL WHERE id = 'Admin' AND is_root = 1;`;
        try {
          execSync(`npx wrangler d1 execute beam-app-db --remote --command="${sql}"`, { stdio: 'inherit' });
          console.log('✅ Root password updated on remote D1 (production).');
        } catch (e) {
          console.log('⚠️  Remote update failed, trying local D1...');
          execSync(`npx wrangler d1 execute beam-app-db --local --command="${sql}"`, { stdio: 'inherit' });
          console.log('✅ Root password updated on local D1 (development).');
        }
        console.log('\n✅ Done! You can now log in as Admin with your new password.\n');
      } catch (e) {
        console.error('❌ Failed to update password:', e.message);
        console.error('Make sure wrangler is installed and you are logged in (npx wrangler login).');
      }
      rl.close();
    });
  });
}

main();
