import { Connection, PublicKey } from "@solana/web3.js";

// Raydium CP Swap program ID on mainnet
const RAYDIUM_CP_SWAP_MAINNET = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

// RPC endpoint
const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

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
  const connection = new Connection(MAINNET_RPC, "confirmed");
  
  console.log('Fetching ammConfig accounts for Raydium CP Swap on Mainnet...\n');
  console.log(`Program: ${RAYDIUM_CP_SWAP_MAINNET.toBase58()}\n`);

  try {

    // Derive PDAs for indexes 0-10 and check which ones exist
    console.log('=== Derived ammConfig PDAs ===');
    for (let i = 0; i <= 10; i++) {
      const { pda, bump } = deriveAmmConfigPDA(RAYDIUM_CP_SWAP_MAINNET, i);
      
      try {
        const accountInfo = await connection.getAccountInfo(pda);
        const exists = accountInfo !== null;
        const status = exists ? "✓ EXISTS" : "✗ NOT FOUND";
        
        console.log(`Config Index ${i}:`);
        console.log(`  Address: ${pda.toBase58()}`);
        console.log(`  Bump: ${bump}`);
        console.log(`  Status: ${status}`);
        
        if (exists && accountInfo) {
          console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
          console.log(`  Lamports: ${accountInfo.lamports}`);
          console.log(`  Data length: ${accountInfo.data.length}`);
        }
      } catch (error) {
        console.log(`Config Index ${i}: Error fetching account`);
      }
      
      console.log();
    }

  } catch (error) {
    console.error("Error fetching accounts:", error);
  }
}

main();
