import { PublicKey } from "@solana/web3.js";
import * as anchor from '@coral-xyz/anchor';

// CPMM program IDs
const DEVNET_CPMM = new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
const MAINNET_CPMM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

function u16ToBytes(num: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(num);
  return buf;
}

function deriveAmmConfigPDA(programId: PublicKey, index: number) {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("amm_config"), u16ToBytes(index)],
    programId
  );
  return { pda, bump };
}

async function main() {
  console.log('Deriving ammConfig PDAs for different indexes...\n');
  
  console.log('=== DEVNET CPMM Program ===');
  console.log(`Program: ${DEVNET_CPMM.toBase58()}\n`);
  
  for (let i = 0; i < 5; i++) {
    const { pda, bump } = deriveAmmConfigPDA(DEVNET_CPMM, i);
    console.log(`Config Index ${i}:`);
    console.log(`  Address: ${pda.toBase58()}`);
    console.log(`  Bump: ${bump}`);
  }
  
  console.log('\n=== MAINNET CPMM Program ===');
  console.log(`Program: ${MAINNET_CPMM.toBase58()}\n`);
  
  for (let i = 0; i < 5; i++) {
    const { pda, bump } = deriveAmmConfigPDA(MAINNET_CPMM, i);
    console.log(`Config Index ${i}:`);
    console.log(`  Address: ${pda.toBase58()}`);
    console.log(`  Bump: ${bump}`);
  }
  
  console.log('\n=== Verification ===');
  console.log('The address from API: 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy');
  
  const mainnetConfig0 = deriveAmmConfigPDA(MAINNET_CPMM, 0);
  console.log(`Matches mainnet index 0: ${mainnetConfig0.pda.toBase58() === '5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy'}`);
  
  const devnetConfig0 = deriveAmmConfigPDA(DEVNET_CPMM, 0);
  console.log(`Matches devnet index 0: ${devnetConfig0.pda.toBase58() === '5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy'}`);
  
  console.log('\n👉 For devnet, use the DEVNET addresses listed above!');
}

main();
