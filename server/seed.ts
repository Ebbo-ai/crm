import bcrypt from "bcryptjs";
import { storage } from "./storage";

export async function seedDatabase() {
  const existingAdmin = await storage.getUserByEmail("admin@simplebenefits.com");
  if (existingAdmin) return;

  const hashedPassword = await bcrypt.hash("Admin123!", 10);
  await storage.createUser({
    email: "admin@simplebenefits.com",
    password: hashedPassword,
    fullName: "System Administrator",
    role: "ADMIN",
    isActive: true,
  });

  const client1 = await storage.createClient({
    clientCode: "S-001",
    clientName: "Acme Manufacturing Corp",
    streetAddress: "1200 Industrial Blvd",
    suiteUnit: "Suite 300",
    city: "Detroit",
    state: "MI",
    zipCode: "48201",
    industryType: "Manufacturing",
    numberOfEmployees: 450,
    isActive: true,
    planType: "DENTAL_VISION",
    networkActive: true,
    dentalNetworkName: "Dentemax",
    decisionMakerName: "Robert Chen",
    decisionMakerTitle: "VP of Human Resources",
    decisionMakerPhone: "(313) 555-0142",
    decisionMakerEmail: "rchen@acmemfg.com",
    adminContactName: "Maria Santos",
    adminContactTitle: "Benefits Coordinator",
    adminContactPhone: "(313) 555-0198",
    adminContactEmail: "msantos@acmemfg.com",
    hasBroker: true,
    brokerFirmName: "Midwest Benefits Group",
    brokerContactName: "James Patterson",
    brokerPhone: "(248) 555-0177",
    brokerEmail: "jpatterson@mwbenefits.com",
    bankingType: "CLIENT_BANK",
    fundingType: "REQUIRES_APPROVAL",
  });

  const client2 = await storage.createClient({
    clientCode: "S-002",
    clientName: "Bright Horizons Schools",
    streetAddress: "890 Education Way",
    city: "Columbus",
    state: "OH",
    zipCode: "43215",
    industryType: "Education",
    numberOfEmployees: 210,
    isActive: true,
    planType: "DENTAL",
    networkActive: false,
    decisionMakerName: "Jennifer Walsh",
    decisionMakerTitle: "Director of Operations",
    decisionMakerPhone: "(614) 555-0233",
    decisionMakerEmail: "jwalsh@brighthorizons.edu",
    adminContactName: "David Kim",
    adminContactTitle: "HR Manager",
    adminContactPhone: "(614) 555-0244",
    adminContactEmail: "dkim@brighthorizons.edu",
    hasBroker: false,
    bankingType: "NINETY_DEGREE_BANK",
    fundingType: "PROCESS_WITHOUT_APPROVAL",
  });

  const client3 = await storage.createClient({
    clientCode: "S-003",
    clientName: "Delta Construction Group",
    streetAddress: "456 Builder Lane",
    suiteUnit: "Floor 5",
    city: "Phoenix",
    state: "AZ",
    zipCode: "85001",
    industryType: "Construction",
    numberOfEmployees: 620,
    isActive: true,
    planType: "DENTAL_HEARING_VISION",
    networkActive: true,
    dentalNetworkName: "Dentemax",
    decisionMakerName: "Carlos Rivera",
    decisionMakerTitle: "CEO",
    decisionMakerPhone: "(602) 555-0311",
    decisionMakerEmail: "crivera@deltaconstruction.com",
    adminContactName: "Linda Park",
    adminContactTitle: "Admin Contact",
    adminContactPhone: "(602) 555-0322",
    adminContactEmail: "lpark@deltaconstruction.com",
    hasBroker: true,
    brokerFirmName: "Southwest Insurance Partners",
    brokerContactName: "Amanda Foster",
    brokerPhone: "(480) 555-0399",
    brokerEmail: "afoster@swinsurance.com",
    bankingType: "CLIENT_BANK",
    fundingType: "REQUIRES_APPROVAL",
  });

  const client4 = await storage.createClient({
    clientCode: "S-004",
    clientName: "Evergreen Healthcare",
    streetAddress: "777 Medical Center Dr",
    city: "Portland",
    state: "OR",
    zipCode: "97201",
    industryType: "Healthcare",
    numberOfEmployees: 340,
    isActive: false,
    terminationDate: new Date("2025-12-31"),
    planType: "HEARING_VISION",
    networkActive: false,
    decisionMakerName: "Dr. Sarah Mitchell",
    decisionMakerTitle: "Chief Medical Officer",
    decisionMakerPhone: "(503) 555-0455",
    decisionMakerEmail: "smitchell@evergreenhealth.com",
    adminContactName: "Tom Bradley",
    adminContactTitle: "Office Manager",
    adminContactPhone: "(503) 555-0466",
    adminContactEmail: "tbradley@evergreenhealth.com",
    hasBroker: false,
    bankingType: "NINETY_DEGREE_BANK",
    fundingType: "PROCESS_WITHOUT_APPROVAL",
  });

  const plan1 = await storage.createPlan({
    clientId: client1.id,
    planName: "Dental Premier Plan",
    effectiveDate: new Date("2025-01-01"),
    planBasis: "PROCEDURE_BASED",
    preventivePercent: 100,
    correctivePercent: 80,
    restorativePercent: 50,
    annualLimit: "2000.00",
    deductible: "50.00",
    isArchived: false,
    planYear: 2025,
  });

  await storage.upsertRateCards(plan1.id, [
    { planId: plan1.id, tier: "EE", baseAdminFee: "8.50", simpleFee: "3.25", networkFee: "2.00", brokerFee: "1.50", totalAdminFee: "13.75", totalFee: "15.25", expectedClaims: "32.00", monthlyPremium: "47.25" },
    { planId: plan1.id, tier: "EE_CHILD", baseAdminFee: "14.00", simpleFee: "5.50", networkFee: "3.50", brokerFee: "2.50", totalAdminFee: "23.00", totalFee: "25.50", expectedClaims: "55.00", monthlyPremium: "80.50" },
    { planId: plan1.id, tier: "EE_SPOUSE", baseAdminFee: "16.00", simpleFee: "6.00", networkFee: "4.00", brokerFee: "3.00", totalAdminFee: "26.00", totalFee: "29.00", expectedClaims: "62.00", monthlyPremium: "91.00" },
    { planId: plan1.id, tier: "FAMILY", baseAdminFee: "22.00", simpleFee: "8.50", networkFee: "5.50", brokerFee: "4.00", totalAdminFee: "36.00", totalFee: "40.00", expectedClaims: "85.00", monthlyPremium: "125.00" },
  ]);

  await storage.createPlan({
    clientId: client2.id,
    planName: "Basic Dental Coverage",
    effectiveDate: new Date("2025-03-01"),
    planBasis: "DOLLAR_BASED",
    annualLimit: "1000.00",
    deductible: "25.00",
    isArchived: false,
    planYear: 2025,
  });

  await storage.createIssue({
    clientId: client1.id,
    title: "Missing enrollment forms",
    description: "Client has not submitted the annual enrollment forms for 3 new employees who started in January. Follow up with HR coordinator Maria Santos to collect the required paperwork.",
    status: "ACTIVE",
    createdBy: "System Administrator",
  });

  await storage.createIssue({
    clientId: client1.id,
    title: "Claims processing delay",
    description: "Several dental claims from Q4 2024 are still pending review. The claims team needs updated procedure codes from the provider network.",
    status: "ACTIVE",
    createdBy: "System Administrator",
  });

  await storage.createIssue({
    clientId: client3.id,
    title: "Broker fee discrepancy",
    description: "The broker compensation amount on the last invoice does not match the agreed-upon rate. Need to reconcile with Southwest Insurance Partners.",
    status: "ACTIVE",
    createdBy: "System Administrator",
  });

  console.log("Database seeded successfully");
}
