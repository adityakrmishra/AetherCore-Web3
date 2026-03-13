import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../services/api.service';
import { Web3AdminService } from '../services/web3-admin.service';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-panel.component.html'
})
export class AdminPanelComponent implements OnInit {
  stats: any = null;
  leaderboard: any[] = [];
  errorMessage: string | null = null;

  constructor(
    private apiService: ApiService,
    public web3Admin: Web3AdminService
  ) { }

  ngOnInit(): void {
    this.loadApiStats();
    this.loadLeaderboard();
  }

  loadApiStats(): void {
    this.apiService.getProtocolStats().subscribe({
      next: (response: any) => {
        // Unpack the data object and map snake_case to camelCase
        const rawStats = response.data || response;
        this.stats = {
          totalPilots: rawStats.total_pilots || 0,
          totalStaked: rawStats.total_staked || '0.00',
          avgStake: rawStats.avg_stake || '0.00'
        };
      },
      error: (err: any) => {
        console.error('Stats Error:', err);
      }
    });
  }

  loadLeaderboard(): void {
    // Changed getPilotLeaderboard to getLeaderboard
    this.apiService.getLeaderboard(1, 25).subscribe({
      next: (response: any) => {
        this.leaderboard = response.data || [];
      },
      error: (err: any) => { // Added : any here
        console.error('Leaderboard Error:', err);
      }
    });
  }

  async connectWallet(): Promise<void> {
    try {
      this.errorMessage = null;
      await this.web3Admin.connectAdminWallet();
    } catch (error: any) {
      this.errorMessage = error.message;
    }
  }
}