#!/usr/bin/env node
import { Page, launch } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

// Initialize OpenAI
const openai = new OpenAI({ apiKey: 'your-openai-api-key' });

// Email configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password'
  }
});

interface JobDetails {
  title: string;
  company: string;
  description: string;
}

interface Profile {
  name: string;
  title: string;
  url: string;
  email?: string;  // Added optional email field
}

async function loginToLinkedIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('https://www.linkedin.com/login');
  await page.type('#username', username);
  await page.type('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
}

async function searchJobs(page: Page, domain: string): Promise<void> {
  await page.goto('https://www.linkedin.com/jobs/');
  await page.type('.jobs-search-box__text-input', domain);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.jobs-search-results__list');
}

async function getJobDetails(page: Page, jobUrl: string): Promise<JobDetails> {
  await page.goto(jobUrl);
  await page.waitForSelector('.job-view-layout');
  
  const title = await page.$eval('.job-details-jobs-unified-top-card__job-title', el => el.textContent?.trim() || '');
  const company = await page.$eval('.job-details-jobs-unified-top-card__company-name', el => el.textContent?.trim() || '');
  const description = await page.$eval('.jobs-description__content', el => el.textContent?.trim() || '');
  
  return { title, company, description };
}

async function rephraseResume(jobDescription: string, resume: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a professional resume writer." },
      { role: "user", content: `Rephrase the following resume to better fit the job description while maintaining a professional tone and ensuring a high ATS score:\nResume: ${resume}\nJob Description: ${jobDescription}` }
    ],
  });
  
  return response.choices[0]?.message?.content?.trim() ?? resume;
}

async function findHRAndEmployees(page: Page, company: string, jobTitle: string): Promise<Profile[]> {
  await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)} ${encodeURIComponent(jobTitle)}`);
  await page.waitForSelector('.reusable-search__result-container');
  
  const profiles = await page.evaluate(() => {
    const results = Array.from(document.querySelectorAll('.reusable-search__result-container'));
    return results.slice(0, 5).map(result => ({
      name: result.querySelector('.actor-name')?.textContent?.trim() || '',
      title: result.querySelector('.subline-level-1')?.textContent?.trim() || '',
      url: result.querySelector('.app-aware-link')?.getAttribute('href') || ''
    }));
  });
  
  return profiles;
}

async function sendConnectionRequest(page: Page, profileUrl: string, note: string): Promise<void> {
  await page.goto(profileUrl);
  await page.waitForSelector('button[aria-label="Connect"]');
  await page.click('button[aria-label="Connect"]');
  
  await page.waitForSelector('button[aria-label="Add a note"]');
  await page.click('button[aria-label="Add a note"]');
  
  await page.type('#custom-message', note);
  await page.click('button[aria-label="Send now"]');
}

async function createResumePDF(rephreasedResume: string): Promise<string> {
  const doc = new PDFDocument();
  const outputPath = path.join(process.cwd(), 'generated_resume.pdf');
  doc.pipe(fs.createWriteStream(outputPath));
  
  doc.fontSize(16).text('Resume', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(rephreasedResume);
  
  doc.end();
  return outputPath;
}

async function sendEmail(to: string, subject: string, body: string, attachmentPath: string): Promise<void> {
  const mailOptions = {
    from: 'your-email@gmail.com',
    to: to,
    subject: subject,
    text: body,
    attachments: [{
      filename: 'resume.pdf',
      path: attachmentPath
    }]
  };
  
  await transporter.sendMail(mailOptions);
}

async function main() {
  const browser = await launch({ headless: false });
  const page = await browser.newPage();
  
  const username = 'ankuranime54@gmail.com';
  const password = '4383,zz)eAbPMX(';
  const jobDomain = 'software engineer';  // Replace with desired job domain
  const resume = fs.readFileSync('./Ankur Resume - Backend.txt', { encoding: "utf-8" });
  
  await loginToLinkedIn(page, username, password);
  await searchJobs(page, jobDomain);
  
  const jobLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.job-card-container__link')).map(a => a.getAttribute('href')).filter((href): href is string => href !== null);
  });
  
  for (const jobUrl of jobLinks.slice(0, 5)) {  // Process first 5 jobs
    const jobDetails = await getJobDetails(page, jobUrl);
    const rephrasedResume = await rephraseResume(jobDetails.description, resume);
    const pdfPath = await createResumePDF(rephrasedResume);
    
    const contacts = await findHRAndEmployees(page, jobDetails.company, jobDetails.title);
    
    for (const contact of contacts) {
      const note = `Hello ${contact.name}, I'm interested in the ${jobDetails.title} position at ${jobDetails.company}. Would you be willing to provide a referral? Job link: ${jobUrl}`;
      await sendConnectionRequest(page, contact.url, note);
      
      // Assuming we have the email (in reality, you might not have this)
      if (contact.email) {
        const emailBody = `Hello ${contact.name},\n\nI'm interested in the job posting: ${jobUrl}\nPlease find my resume attached.\n\nThank you for your consideration.`;
        await sendEmail(contact.email, `Referral Request for ${jobDetails.title}`, emailBody, pdfPath);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));  // 5 second delay between jobs
  }
  
  await browser.close();
}

main().catch(console.error);