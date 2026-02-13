import { PublicKey, Connection } from "@solana/web3.js";
import * as anchor from '@coral-xyz/anchor';

const DEVNET_CPMM = new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
const CONFIG_ADDRESS = new PublicKey("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy");

async function main() {
  const connection = new Connection('https://devnet.helius-rpc.com/?api-key=d25ddc06-ce2f-4e6c-9ae2-d2f630f3f716', 'confirmed');
  
  console.log('Checking ammConfig account on devnet...\n');
  console.log(`Config Address: ${CONFIG_ADDRESS.toBase58()}`);
  console.log(`Expected Owner: ${DEVNET_CPMM.toBase58()}\n`);
  
  try {
    const accountInfo = await connection.getAccountInfo(CONFIG_ADDRESS);
    
    if (!accountInfo) {
      console.log('❌ Account does not exist on devnet!');
      console.log('\nThis means the config needs to be initialized on devnet first.');
      console.log('You may need to use a different RPC or the config might not be deployed yet.');
      return;
    }
    
    console.log('✅ Account exists!');
    console.log(`Owner: ${accountInfo.owner.toBase58()}`);
    console.log(`Data Length: ${accountInfo.data.length}`);
    console.log(`Lamports: ${accountInfo.lamports}`);
    console.log(`Executable: ${accountInfo.executable}`);
    
    if (accountInfo.owner.equals(DEVNET_CPMM)) {
      console.log('\n✅ Owner matches devnet CPMM program!');
    } else {
      console.log(`\n❌ Owner mismatch!`);
      console.log(`  Expected: ${DEVNET_CPMM.toBase58()}`);
      console.log(`  Actual:   ${accountInfo.owner.toBase58()}`);
      
      // Check if it's the mainnet program
      const MAINNET_CPMM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
      if (accountInfo.owner.equals(MAINNET_CPMM)) {
        console.log('\n⚠️  This account is owned by the MAINNET CPMM program!');
        console.log('This suggests the devnet RPC might be falling back to mainnet data,');
        console.log('or the config is not initialized on devnet.');
      }
    }
    
  } catch (error) {
    console.error('Error fetching account:', error);
  }
}

main();
